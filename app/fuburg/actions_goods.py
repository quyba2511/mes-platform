"""Vật tư: nhập kho AY (531 + 261 thùng), tiêu hao theo ca (261), trả vật tư (262), huỷ chứng từ, sửa sai."""
from __future__ import annotations

from collections import defaultdict
import hashlib
from decimal import ROUND_DOWN, Decimal

from .core import (MesError, action, canon, check_sloc_not_asrs, get_open_order, int_str, need_shift, new_id, now, one,
                   plant_cfg, qty3, rows)


def _movement(c, b, order_no, purpose, items, ref_note):
    mid, txn = new_id(), new_id()
    body = {"plant": c.plant, "order_no": order_no, "movement_id": mid, "txn_id": txn, "source_system": "MES",
            "source_record_id": f"{purpose[:3]}-{mid}", "actor": b["actor"], "purpose": purpose,
            "posting_date": b["posting_date"], "shift": b["shift"],
            "items": [dict(it, line_no=i + 1) for i, it in enumerate(items)]}
    c.conn.execute("INSERT INTO goods_movement VALUES(?,?,?,?,?,?,'QUEUED',NULL,?)", (mid, c.plant, order_no, txn, purpose, canon(body), now()))
    c.track_txn(txn, "GOODS_MOVEMENT", "goods_movement", mid)
    msg = c.enqueue("submit_goods_movement", body, "goods_movement", mid)
    return {"movement_id": mid, "txn_id": txn, "order_no": order_no, "purpose": purpose, "items": body["items"], "outbox_msg": msg, "note": ref_note}


# ------------------------------------------------------------------ AY
@action("report_ay", roles=("MES",), required=("order_no", "ay_material", "quantity", "uom", "storage_location", "posting_date", "shift", "actor"))
def report_ay(c, b):
    """Nhập kho hàng AY (cấp B) của 1 lệnh: 531 hàng AY + 261 thùng carton tự thêm theo cấu hình.
    Hàng bao (không carton, vd D030309/D030308 ở 2101) chỉ có 531. 531 theo B → số carton = số thùng.
    531 theo EA mà có carton → bắt buộc truyền `cartons`."""
    o = get_open_order(c.conn, c.plant, b["order_no"])
    need_shift(b["shift"])
    cfg = plant_cfg(c.plant)
    ay = b["ay_material"]
    if not one(c.conn, "SELECT 1 x FROM order_ay WHERE plant=? AND order_no=? AND ay_material=?", c.plant, o["order_no"], ay):
        raise MesError("AY_MATERIAL_NOT_MAPPED", f"{o['material']}→{ay}")
    m = one(c.conn, "SELECT material_type FROM material WHERE plant=? AND material=?", c.plant, ay)
    if not m or m["material_type"] != "ZHAL":
        raise MesError("AY_MATERIAL_NOT_ZHAL", ay)          # chưa có master → để intf kiểm
    if b["storage_location"] not in cfg["ay_receipt_sloc"]:
        raise MesError("AY_SLOC_NOT_ALLOWED", b["storage_location"])
    q = qty3(b["quantity"])
    items = [{"movement_type": "531", "material": ay, "quantity": str(q), "uom": b["uom"], "storage_location": b["storage_location"]}]
    if ay in cfg["ay_no_pack_materials"]:
        if b["uom"] != "EA":
            raise MesError("AY_BAG_REQUIRES_EA")
        if b.get("cartons"):
            raise MesError("AY_PACK_NOT_EXPECTED", ay)
    elif cfg["ay_pack_required"]:
        carton = cfg["ay_pack_map"].get(ay)
        if not carton:
            raise MesError("AY_PACK_MATERIAL_UNKNOWN", ay)
        if b["uom"] == "B":
            if q != q.to_integral_value():
                raise MesError("AY_PACK_COUNT_MISMATCH", "số thùng phải nguyên")
            n = int(q)
            if b.get("cartons") not in (None, "", n, str(n)):
                raise MesError("AY_PACK_COUNT_MISMATCH", f"cartons={b.get('cartons')} ≠ {n} thùng")
        else:
            n = int_str(b.get("cartons") or "", code="AY_CARTONS_REQUIRED", allow_zero=False)
        carton_sloc = b.get("carton_sloc") or cfg.get("carton_sloc")
        if not carton_sloc:
            raise MesError("CARTON_SLOC_REQUIRED")
        check_sloc_not_asrs(c.plant, carton_sloc)
        items.append({"movement_type": "261", "material": carton, "quantity": str(n), "uom": "EA",
                      "storage_location": carton_sloc})
    return _movement(c, b, o["order_no"], "AY_RECEIPT", items, "531 AY + 261 carton cùng 1 giao dịch")


# ------------------------------------------------------------------ tiêu hao (CONSUMPTION)
@action("record_material_use", roles=("MES",), required=("line", "production_date", "shift", "material", "quantity", "uom", "storage_location"))
def record_material_use(c, b):
    """Ghi vật tư thực dùng của 1 line trong 1 ca (chưa gắn lệnh). Kho 2* bị chặn."""
    need_shift(b["shift"])
    check_sloc_not_asrs(c.plant, b["storage_location"])
    q = qty3(b["quantity"])
    uid = new_id()
    c.conn.execute("INSERT INTO material_use VALUES(?,?,?,?,?,?,?,?,?,NULL,?)",
                   (uid, c.plant, b["line"], b["production_date"], b["shift"], b["material"], str(q), b["uom"], b["storage_location"], now()))
    return {"use_id": uid}


def _plan_consumption(c, b):
    """Phân bổ vật tư của line×ngày×ca cho các lệnh đã chạy, theo tỷ lệ sản lượng (A+B+C).
    Trả {order_no: [items]} – chưa ghi gì."""
    uses = rows(c.conn, "SELECT * FROM material_use WHERE plant=? AND line=? AND production_date=? AND shift=? AND movement_id IS NULL ORDER BY created_at",
                c.plant, b["line"], b["production_date"], b["shift"])
    if not uses:
        raise MesError("NOTHING_TO_ALLOCATE")
    out = {r["order_no"]: r["n"] for r in rows(c.conn, """SELECT r.order_no, SUM(o.pieces) n FROM run r JOIN output_report o ON o.run_id=r.run_id
        WHERE r.plant=? AND r.line=? AND r.production_date=? AND r.shift=? GROUP BY r.order_no""", c.plant, b["line"], b["production_date"], b["shift"])}
    if one(c.conn, "SELECT 1 x FROM run WHERE plant=? AND line=? AND production_date=? AND shift=? AND state='OPEN'", c.plant, b["line"], b["production_date"], b["shift"]):
        raise MesError("SHIFT_HAS_OPEN_RUNS")
    if not out:
        raise MesError("NO_OUTPUT_IN_SHIFT")
    agg: dict[tuple, Decimal] = defaultdict(Decimal)
    for u in uses:
        agg[(u["material"], u["uom"], u["storage_location"])] += Decimal(u["quantity"])
    plan: dict[str, list] = defaultdict(list)
    for (mat, uom, sloc), total in agg.items():
        elig = []
        for order_no, n in sorted(out.items()):
            candidates = rows(c.conn, "SELECT reservation_no,reservation_item FROM order_component WHERE plant=? AND order_no=? AND material=? AND backflush=0", c.plant, order_no, mat)
            if len(candidates) > 1:
                raise MesError("AMBIGUOUS_RESERVATION", mat)
            comp = one(c.conn, """SELECT * FROM order_component WHERE plant=? AND order_no=? AND material=? AND backflush=0
                                  ORDER BY reservation_item LIMIT 1""", c.plant, order_no, mat)
            if comp:
                if uom != comp["issue_uom"] and not one(c.conn, "SELECT 1 x FROM material_uom WHERE plant=? AND material=? AND uom=?", c.plant, mat, uom):
                    raise MesError("UOM_CONVERSION_FAILED", f"{mat} {uom}≠{comp['issue_uom']}")
                elig.append((order_no, n, comp))
        if not elig:
            raise MesError("COMPONENT_NOT_IN_ORDER", f"{mat} không có trong lệnh nào của ca (hoặc là backflush)")
        weight = sum(n for _, n, _ in elig)
        left = total
        for i, (order_no, n, comp) in enumerate(elig):
            share = left if i == len(elig) - 1 else (total * n / weight).quantize(Decimal("0.001"), rounding=ROUND_DOWN)
            left -= share
            if share > 0:
                plan[order_no].append({"movement_type": "261", "material": mat, "quantity": str(share), "uom": uom, "storage_location": sloc,
                                       "reservation_no": comp["reservation_no"], "reservation_item": comp["reservation_item"]})
    return uses, out, plan


@action("preview_consumption", roles=("MES", "LEAD"), readonly=True, required=("line", "production_date", "shift"))
def preview_consumption(c, b):
    """Xem trước kết quả phân bổ (không ghi). Tổ trưởng kiểm rồi mới gọi allocate_consumption."""
    uses, out, plan = _plan_consumption(c, b)
    return {"output_by_order": out, "plan": plan, "preview_token": _plan_token(uses, out, plan)}


def _plan_token(uses, out, plan):
    return hashlib.sha256(canon({"uses": sorted(u["use_id"] for u in uses), "output": out, "plan": plan}).encode()).hexdigest()


@action("allocate_consumption", roles=("LEAD",), required=("line", "production_date", "shift", "posting_date", "actor"))
def allocate_consumption(c, b):
    """Chốt phân bổ: mỗi lệnh 1 submit_goods_movement CONSUMPTION (261, có reservation)."""
    need_shift(b["shift"])
    uses, out, plan = _plan_consumption(c, b)
    if b.get("preview_token") != _plan_token(uses, out, plan):
        raise MesError("CONSUMPTION_PREVIEW_CHANGED")
    res = [_movement(c, b, order_no, "CONSUMPTION", items, f"phân bổ theo sản lượng {out[order_no]}/{sum(out.values())}")
           for order_no, items in sorted(plan.items())]
    c.conn.executemany("UPDATE material_use SET movement_id=? WHERE use_id=?", [("ALLOCATED", u["use_id"]) for u in uses])
    return {"movements": res}


@action("return_material", roles=("MES",), required=("order_no", "items", "posting_date", "shift", "actor"))
def return_material(c, b):
    """Trả vật tư dư về kho (262) cho 1 lệnh. items=[{material, quantity, uom, storage_location}]."""
    o = get_open_order(c.conn, c.plant, b["order_no"])
    need_shift(b["shift"])
    items = []
    for it in b["items"]:
        check_sloc_not_asrs(c.plant, it["storage_location"])
        candidates = rows(c.conn, "SELECT reservation_item FROM order_component WHERE plant=? AND order_no=? AND material=? AND backflush=0", c.plant, o["order_no"], it["material"])
        if len(candidates) > 1:
            raise MesError("AMBIGUOUS_RESERVATION", it["material"])
        comp = one(c.conn, "SELECT * FROM order_component WHERE plant=? AND order_no=? AND material=? AND backflush=0 ORDER BY reservation_item LIMIT 1",
                   c.plant, o["order_no"], it["material"])
        if not comp:
            raise MesError("COMPONENT_NOT_IN_ORDER", it["material"])
        if it["uom"] != comp["issue_uom"] and not one(c.conn, "SELECT 1 x FROM material_uom WHERE plant=? AND material=? AND uom=?", c.plant, it["material"], it["uom"]):
            raise MesError("UOM_CONVERSION_FAILED")
        items.append({"movement_type": "262", "material": it["material"], "quantity": str(qty3(it["quantity"])), "uom": it["uom"],
                      "storage_location": it["storage_location"], "reservation_no": comp["reservation_no"], "reservation_item": comp["reservation_item"]})
    return _movement(c, b, o["order_no"], "CONSUMPTION", items, "262 trả vật tư")


# ------------------------------------------------------------------ huỷ / sửa sai (chuyển thẳng sang intf)
@action("cancel_document", roles=("LEAD",), required=("document_no", "document_year", "reason", "posting_date", "shift", "actor"))
def cancel_document(c, b):
    """Đảo chứng từ vật tư SAP đã POSTED (GR/AY/261…) – tạo giao dịch GOODS_CANCEL."""
    need_shift(b["shift"])
    mid, txn = new_id(), new_id()
    body = {"plant": c.plant, "movement_id": mid, "txn_id": txn, "source_system": "MES", "source_record_id": "REV-" + mid,
            "actor": b["actor"], "document_no": b["document_no"], "document_year": str(b["document_year"]), "reason": b["reason"],
            "posting_date": b["posting_date"], "shift": b["shift"]}
    c.conn.execute("INSERT INTO goods_movement VALUES(?,?,NULL,?,'REVERSAL',?,'QUEUED',NULL,?)", (mid, c.plant, txn, canon(body), now()))
    c.track_txn(txn, "GOODS_CANCEL", "goods_movement", mid)
    return {"movement_id": mid, "txn_id": txn, "outbox_msg": c.enqueue("cancel_document", body, "goods_movement", mid)}


@action("cancel_txn", roles=("LEAD",), required=("txn_id", "reason", "actor"))
def cancel_txn(c, b):
    """Huỷ giao dịch SAP chưa được SAP nhận (PENDING/APPROVED/FAILED). Đã POSTED → dùng request_correction / cancel_document."""
    t = one(c.conn, "SELECT * FROM txn_ref WHERE txn_id=? AND plant=?", b["txn_id"].upper(), c.plant)
    if not t:
        raise MesError("TXN_NOT_FOUND", b["txn_id"])
    if t["sap_state"] not in ("PENDING", "APPROVED", "FAILED"):
        raise MesError("TXN_NOT_CANCELLABLE", t["sap_state"])
    body = {"plant": c.plant, "txn_id": t["txn_id"], "actor": b["actor"], "reason": b["reason"]}
    return {"txn_id": t["txn_id"], "outbox_msg": c.enqueue("cancel_txn", body, "cancel_txn", t["txn_id"], depends_on=c.msg_for(t["ref_kind"], t["ref_id"]))}


@action("request_correction", roles=("LEAD",), required=("completion_id", "original_txn_id", "reason", "actor", "evidence_ref"))
def request_correction(c, b):
    """Báo công đã POSTED nhưng sai → mở case sửa sai (SAP xử lý, khoá posting của completion)."""
    t = one(c.conn, "SELECT * FROM txn_ref WHERE txn_id=? AND plant=? AND ref_kind='completion' AND ref_id=?", b["original_txn_id"].upper(), c.plant, b["completion_id"])
    if not t or t["sap_state"] != "POSTED":
        raise MesError("CORRECTION_REQUIRES_POSTED_COMPLETION")
    case = new_id()
    body = {"plant": c.plant, "completion_id": b["completion_id"], "command_id": new_id(), "actor": b["actor"],
            "evidence_ref": b["evidence_ref"], "source_ref": "COR-" + case, "case_id": case,
            "original_txn_id": b["original_txn_id"].upper(), "reason": b["reason"]}
    return {"case_id": case, "outbox_msg": c.enqueue("request_correction", body, "correction", case)}
