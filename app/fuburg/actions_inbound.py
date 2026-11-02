"""Nhận dữ liệu từ 中介庫 (event claim_delivery) – chỉ worker gọi (role SYNC).
ingest_event dedupe theo event_id; ghi xong mới được ack (worker lo việc ack)."""
from __future__ import annotations

import json

from .core import MesError, action, canon, now, one


@action("ingest_event", roles=("SYNC",), required=("event_id", "event_type", "payload"))
def ingest_event(c, b):
    """Áp 1 event intf vào DB MES. Gửi lại cùng event_id → {duplicate:true}, không áp lần 2."""
    existing = one(c.conn, "SELECT * FROM inbox_event WHERE event_id=?", b["event_id"])
    if existing and (existing["plant"] != c.plant or existing["payload"] != canon(b["payload"]) or existing["event_type"] != b["event_type"]):
        raise MesError("EVENT_CONFLICT")
    if existing:
        return {"event_id": b["event_id"], "duplicate": True}
    p = b["payload"]
    if not isinstance(p, dict) or (p.get("plant") is not None and str(p["plant"]) != c.plant):
        raise MesError("EVENT_PLANT_MISMATCH")
    t = b["event_type"]
    fn = {"ORDER": _order, "MASTER": _master, "BUSINESS_RESULT": _business, "TXN_RESULT": _txn}.get(t)
    if fn is None:
        raise MesError("UNKNOWN_EVENT_TYPE", t)
    outcome = fn(c, p)
    c.conn.execute("INSERT INTO inbox_event VALUES(?,?,?,?,?,?)", (b["event_id"], c.plant, t, canon(p), now(), outcome))
    return {"event_id": b["event_id"], "event_type": t, "outcome": outcome}


def _order(c, p):
    plant, order_no, ver = p["plant"], p["order_no"], int(p["source_version"])
    cur = one(c.conn, "SELECT source_version FROM work_order WHERE plant=? AND order_no=?", plant, order_no)
    if cur and cur["source_version"] >= ver:
        return "IGNORED_STALE"          # bản cũ hơn / bằng → bỏ qua (vẫn ack)
    m = p.get("material") or {}
    rate = p.get("order_uom_rate") or {}
    c.conn.execute("DELETE FROM work_order WHERE plant=? AND order_no=?", (plant, order_no))
    c.conn.execute(
        """INSERT INTO work_order(plant,order_no,source_version,order_type,material,description,order_uom,order_uom_num,order_uom_den,
           order_uom_src,planned_qty,planned_pieces,main_work_center,site,released,closed,deleted,planned_start,planned_end,
           production_note,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (plant, order_no, ver, p.get("order_type"), m.get("material"), m.get("description"), p.get("order_uom"),
         rate.get("numerator"), rate.get("denominator"), rate.get("source"), str(p.get("planned_qty")),
         int(p.get("planned_pieces") or 0), p.get("main_work_center"), p.get("site"), int(bool(p.get("released"))),
         int(bool(p.get("closed"))), int(bool(p.get("deleted"))), p.get("planned_start"), p.get("planned_end"),
         p.get("production_note"), canon(p), now()))
    for tbl in ("order_component", "order_operation", "order_ay"):
        c.conn.execute(f"DELETE FROM {tbl} WHERE plant=? AND order_no=?", (plant, order_no))
    for x in p.get("components") or []:
        c.conn.execute("INSERT INTO order_component VALUES(?,?,?,?,?,?,?,?,?)",
                       (plant, order_no, x["reservation_no"], x["reservation_item"], x["material"], x["issue_uom"],
                        str(x.get("required_qty")), x.get("storage_location"), int(bool(x.get("backflush")))))
    for x in p.get("operations") or []:
        c.conn.execute("INSERT INTO order_operation VALUES(?,?,?,?,?,?,?)",
                       (plant, order_no, x["operation_no"], x.get("work_center"), x.get("control_key"), x.get("operation_uom"), x.get("operation_key")))
    for x in p.get("ay_materials") or []:
        c.conn.execute("INSERT INTO order_ay VALUES(?,?,?)", (plant, order_no, x["ay_material"]))
    if m:
        _upsert_material(c, plant, m)
    return "APPLIED"


def _upsert_material(c, plant, m):
    ver = int(m.get("source_version") or 0)
    cur = one(c.conn, "SELECT source_version FROM material WHERE plant=? AND material=?", plant, m["material"])
    if cur and cur["source_version"] > ver:
        return "IGNORED_STALE"
    c.conn.execute("DELETE FROM material WHERE plant=? AND material=?", (plant, m["material"]))
    c.conn.execute("INSERT INTO material VALUES(?,?,?,?,?,?,?,?)",
                   (plant, m["material"], m.get("material_type"), m.get("base_uom"), m.get("description"),
                    int(bool(m.get("batch_managed"))), ver, now()))
    if "uoms" in m:
        c.conn.execute("DELETE FROM material_uom WHERE plant=? AND material=?", (plant, m["material"]))
        for u in m["uoms"]:
            c.conn.execute("INSERT INTO material_uom VALUES(?,?,?,?,?)", (plant, m["material"], u["uom"], int(u["numerator"]), int(u["denominator"])))
    return "APPLIED"


def _master(c, p):
    if p.get("kind") == "material":
        return _upsert_material(c, c.plant, p)
    return "IGNORED_KIND_" + str(p.get("kind"))   # kind=uom (T006): MES hiện chưa dùng


_BIZ = {  # action intf → (bảng, khoá, trạng thái khi accepted)
    "release_quality": ("release_lot", "release_id", "ACCEPTED"),
    "record_packaging": ("package", "package_id", "ACCEPTED"),
    "submit_receipt": ("receipt", "receipt_id", "DRAFT"),
}


def _business(c, p):
    a = p.get("action")
    if a in _BIZ:
        tbl, key, st = _BIZ[a]
        c.conn.execute(f"UPDATE {tbl} SET state=? WHERE {key}=? AND plant=? AND state='QUEUED'", (st, p.get(key), c.plant))
    elif a == "decide_receipt":
        st = "APPROVED" if p.get("decision") == "APPROVE" else "REJECTED"
        c.conn.execute("UPDATE receipt SET state=? WHERE receipt_id=? AND plant=? AND state IN ('QUEUED','DRAFT','DECISION_QUEUED')", (st, p.get("receipt_id"), c.plant))
    return "APPLIED"


def _txn(c, p):
    t = one(c.conn, "SELECT * FROM txn_ref WHERE txn_id=? AND plant=?", str(p.get("txn_id")).upper(), c.plant)
    if not t:
        return "IGNORED_UNKNOWN_TXN"   # giao dịch không do MES này tạo
    state = p.get("state")
    c.conn.execute("UPDATE txn_ref SET sap_state=?, result=?, updated_at=? WHERE txn_id=?",
                   (state, json.dumps({k: v for k, v in p.items() if k != "claim_token"}, ensure_ascii=False), now(), t["txn_id"]))
    if state == "CANCELLED":
        if t["ref_kind"] == "completion":
            c.conn.execute("UPDATE completion SET state='CANCELLED' WHERE completion_id=?", (t["ref_id"],))
        elif t["ref_kind"] == "receipt":
            c.conn.execute("UPDATE receipt SET state='REJECTED' WHERE receipt_id=?", (t["ref_id"],))
        elif t["ref_kind"] == "goods_movement":
            c.conn.execute("UPDATE goods_movement SET state='CANCELLED' WHERE movement_id=?", (t["ref_id"],))
    return "APPLIED"
