"""Sản xuất → báo công → QC → đóng gói → nhập kho.
Action MES nội bộ (start_run, report_output, finish_run) chỉ ghi DB MES.
Action có hậu tố gửi intf (confirm_completion, release_quality, record_packaging, submit_receipt, decide_receipt)
ghi DB MES + 1 message outbox trong CÙNG giao dịch; worker gửi sau."""
from __future__ import annotations

from .core import (MesError, action, check_sloc_not_asrs, get_open_order, int_str, need_shift, new_id, now, one,
                   pieces_per, plant_cfg, rows)


# ------------------------------------------------------------------ chạy máy
@action("start_run", roles=("MES",), required=("order_no", "line", "production_date", "shift", "operator"))
def start_run(c, b):
    """Bắt đầu chạy 1 lệnh trên 1 line trong 1 ca."""
    o = get_open_order(c.conn, c.plant, b["order_no"])
    need_shift(b["shift"])
    if not o["site"]:
        raise MesError("ORDER_SITE_MISSING", b["order_no"])
    if one(c.conn, "SELECT 1 x FROM run WHERE plant=? AND line=? AND state='OPEN'", c.plant, b["line"]):
        raise MesError("LINE_BUSY", b["line"])
    run_id = b.get("run_id") or new_id()
    c.conn.execute("INSERT INTO run(run_id,plant,order_no,line,production_date,shift,operator,started_at,state,order_version) VALUES(?,?,?,?,?,?,?,?, 'OPEN',?)",
                   (run_id, c.plant, b["order_no"], b["line"], b["production_date"], b["shift"], b["operator"], b.get("started_at") or now(), o["source_version"]))
    return {"run_id": run_id, "state": "OPEN"}


@action("report_output", roles=("MES",), required=("run_id", "grade_code", "pieces"))
def report_output(c, b):
    """Báo sản lượng theo cấp (A/B/C). Gọi nhiều lần trong 1 run; nên kèm request_id để chống bấm 2 lần."""
    r = one(c.conn, "SELECT * FROM run WHERE run_id=? AND plant=?", b["run_id"], c.plant)
    if not r or r["state"] != "OPEN":
        raise MesError("RUN_NOT_OPEN", b["run_id"])
    order = get_open_order(c.conn, c.plant, r["order_no"])
    if r["order_version"] != order["source_version"]:
        raise MesError("ORDER_VERSION_CHANGED")
    codes = {g["grade_code"] for g in plant_cfg(c.plant)["grades"]}
    if b["grade_code"] not in codes:
        raise MesError("UNKNOWN_GRADE_CODE", b["grade_code"])
    n = int_str(b["pieces"], allow_zero=False)
    rid = new_id()
    c.conn.execute("INSERT INTO output_report VALUES(?,?,?,?,?,?)", (rid, b["run_id"], b["grade_code"], n, now(), b.get("actor")))
    return {"report_id": rid, "run_id": b["run_id"], "grade_code": b["grade_code"], "pieces": n}


@action("finish_run", roles=("MES",), required=("run_id", "machine_minutes"))
def finish_run(c, b):
    """Kết thúc run; labor = [{work_center, headcount, labor_minutes}]."""
    r = one(c.conn, "SELECT * FROM run WHERE run_id=? AND plant=?", b["run_id"], c.plant)
    if not r or r["state"] != "OPEN":
        raise MesError("RUN_NOT_OPEN", b["run_id"])
    import json
    c.conn.execute("UPDATE run SET state='FINISHED', finished_at=?, machine_minutes=?, labor=? WHERE run_id=?",
                   (b.get("finished_at") or now(), int_str(b["machine_minutes"]), json.dumps(b.get("labor") or []), b["run_id"]))
    return {"run_id": b["run_id"], "state": "FINISHED"}


# ------------------------------------------------------------------ báo công → intf submit_completion
@action("confirm_completion", roles=("LEAD",), required=("run_ids", "posting_date", "approved_by", "approval_ref", "actor"))
def confirm_completion(c, b):
    """Tổ trưởng xác nhận các run (cùng 1 lệnh) → tạo 1 báo công gửi intf submit_completion.
    A=GOOD → good_pieces, C=SCRAP → scrap_pieces, B=AY → chỉ nằm trong grades[] (không tính good/scrap)."""
    import json
    ids = list(dict.fromkeys(b["run_ids"]))
    runs = [one(c.conn, "SELECT * FROM run WHERE run_id=? AND plant=?", i, c.plant) for i in ids]
    if any(r is None or r["state"] != "FINISHED" for r in runs):
        raise MesError("RUN_NOT_FINISHED")
    if len({r["order_no"] for r in runs}) != 1:
        raise MesError("RUNS_DIFFERENT_ORDERS")
    o = get_open_order(c.conn, c.plant, runs[0]["order_no"])
    if any(r["order_version"] != o["source_version"] for r in runs):
        raise MesError("ORDER_VERSION_CHANGED")
    cfg = plant_cfg(c.plant)
    disp = {g["grade_code"]: g["disposition"] for g in cfg["grades"]}
    qm = ",".join("?" * len(ids))
    tot = {x["grade_code"]: x["n"] for x in rows(c.conn, f"SELECT grade_code, SUM(pieces) n FROM output_report WHERE run_id IN ({qm}) GROUP BY grade_code", *ids)}
    good = sum(n for g, n in tot.items() if disp[g] == "GOOD")
    scrap = sum(n for g, n in tot.items() if disp[g] == "SCRAP")
    ay = sum(n for g, n in tot.items() if disp[g] == "AY")
    if good <= 0:
        raise MesError("GOOD_PIECES_REQUIRED", "intf yêu cầu good_pieces > 0")
    labor: dict[str, dict] = {}
    for r in runs:
        for l in json.loads(r["labor"] or "[]"):
            x = labor.setdefault(l["work_center"], {"work_center": l["work_center"], "headcount": 0, "labor_minutes": 0})
            x["headcount"] = max(x["headcount"], int(l["headcount"]))
            x["labor_minutes"] += int(l["labor_minutes"])
    cid, pp = new_id(), new_id()
    body = {
        "plant": c.plant, "order_no": o["order_no"], "order_version": o["source_version"], "site": o["site"],
        "completion_id": cid, "pp_txn_id": pp, "source_system": "MES", "source_record_id": "CMP-" + cid,
        "production_date": min(r["production_date"] for r in runs), "posting_date": b["posting_date"],
        "started_at": min(r["started_at"] for r in runs), "finished_at": max(r["finished_at"] for r in runs),
        "good_pieces": str(good), "scrap_pieces": str(scrap),
        "machine_minutes": str(sum(r["machine_minutes"] or 0 for r in runs)),
        "labor": [{"work_center": x["work_center"], "headcount": x["headcount"], "labor_minutes": str(x["labor_minutes"])} for x in labor.values()],
        "grade_rule_ref": cfg["grade_rule_ref"]["value"],
        "grades": [{"grade_code": g, "disposition": disp[g], "pieces": str(n)} for g, n in sorted(tot.items())],
        "approved_by": b["approved_by"], "approval_ref": b["approval_ref"],
        "final_confirmation": bool(b.get("final_confirmation", False)),
    }
    snapshot = dict(o, material_rates=rows(c.conn, "SELECT uom,numerator,denominator FROM material_uom WHERE plant=? AND material=?", c.plant, o["material"]))
    c.conn.execute("INSERT INTO completion(completion_id,plant,order_no,site,pp_txn_id,good_pieces,scrap_pieces,ay_pieces,order_snapshot,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',?)", (cid, c.plant, o["order_no"], o["site"], pp, good, scrap, ay, json.dumps(snapshot), now()))
    c.conn.execute(f"UPDATE run SET state='CONFIRMED', completion_id=? WHERE run_id IN ({qm})", (cid, *ids))
    c.track_txn(pp, "PP_CONFIRM", "completion", cid)
    msg = c.enqueue("submit_completion", body, "completion", cid)
    return {"completion_id": cid, "pp_txn_id": pp, "good_pieces": good, "scrap_pieces": scrap, "ay_pieces": ay, "outbox_msg": msg}


def _completion(c, cid):
    x = one(c.conn, "SELECT * FROM completion WHERE completion_id=? AND plant=?", cid, c.plant)
    if not x:
        raise MesError("COMPLETION_NOT_FOUND", cid)
    if x["state"] in ("REJECTED", "CANCELLED"):
        raise MesError("COMPLETION_" + x["state"], cid)
    return x


def _cmd_base(c, b, completion_id):
    return {"plant": c.plant, "completion_id": completion_id, "command_id": new_id(), "actor": b["actor"],
            "evidence_ref": b["evidence_ref"]}


# ------------------------------------------------------------------ QC
@action("release_quality", roles=("QA",), required=("completion_id", "pieces", "actor", "evidence_ref"))
def release_quality(c, b):
    """QC cho phép số lượng 良品 (A) được đóng gói. Tổng release ≤ good_pieces."""
    x = _completion(c, b["completion_id"])
    n = int_str(b["pieces"], allow_zero=False)
    done = one(c.conn, "SELECT COALESCE(SUM(pieces),0) s FROM release_lot WHERE completion_id=? AND state<>'REJECTED'", x["completion_id"])["s"]
    if done + n > x["good_pieces"]:
        raise MesError("RELEASE_EXCEEDS_GOOD", f"{done}+{n}>{x['good_pieces']}")
    rel = new_id()
    body = _cmd_base(c, b, x["completion_id"]) | {"release_id": rel, "pieces": str(n), "source_ref": "REL-" + rel}
    c.conn.execute("INSERT INTO release_lot VALUES(?,?,?,?,'QUEUED',NULL,?)", (rel, c.plant, x["completion_id"], n, now()))
    msg = c.enqueue("release_quality", body, "release_lot", rel, depends_on=c.msg_for("completion", x["completion_id"]))
    return {"release_id": rel, "pieces": n, "outbox_msg": msg}


# ------------------------------------------------------------------ đóng gói
@action("record_packaging", roles=("MES",), required=("release_id", "package_uom", "actual_packages", "loose_pieces", "lot_no", "actor", "evidence_ref"))
def record_packaging(c, b):
    """Đóng gói từ 1 lần release. pieces = thùng × quy đổi + lẻ (≤ phần release còn lại)."""
    rel = one(c.conn, "SELECT * FROM release_lot WHERE release_id=? AND plant=?", b["release_id"], c.plant)
    if not rel or rel["state"] == "REJECTED":
        raise MesError("RELEASE_NOT_FOUND", b["release_id"])
    x = _completion(c, rel["completion_id"])
    import json
    o = json.loads(x["order_snapshot"])
    packs, loose = int_str(b["actual_packages"]), int_str(b["loose_pieces"])
    pieces = packs * pieces_per(c.conn, c.plant, o, b["package_uom"]) + loose
    if pieces <= 0:
        raise MesError("PACKAGE_EMPTY")
    used = one(c.conn, "SELECT COALESCE(SUM(pieces),0) s FROM package WHERE release_id=? AND state<>'REJECTED'", rel["release_id"])["s"]
    if used + pieces > rel["pieces"]:
        raise MesError("PACKAGE_EXCEEDS_RELEASE", f"{used}+{pieces}>{rel['pieces']}")
    pk = new_id()
    body = _cmd_base(c, b, x["completion_id"]) | {
        "release_id": rel["release_id"], "package_id": pk, "package_uom": b["package_uom"], "actual_packages": str(packs),
        "loose_pieces": str(loose), "lot_no": b["lot_no"], "source_ref": "PKG-" + pk}
    c.conn.execute("INSERT INTO package VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',NULL,?)",
                   (pk, c.plant, x["completion_id"], rel["release_id"], b["package_uom"], packs, loose, pieces, b["lot_no"], now()))
    msg = c.enqueue("record_packaging", body, "package", pk, depends_on=c.msg_for("release_lot", rel["release_id"]))
    return {"package_id": pk, "pieces": pieces, "outbox_msg": msg}


# ------------------------------------------------------------------ nhập kho
@action("submit_receipt", roles=("MES", "WH"), required=("package_id", "actual_packages", "loose_pieces", "storage_location", "posting_date", "shift", "actor", "evidence_ref"))
def submit_receipt(c, b):
    """Xin nhập kho (GR 101). Không lẻ → gửi theo đơn vị thùng; có lẻ → gửi EA. Kho 2* bị chặn (ASRS)."""
    pk = one(c.conn, "SELECT * FROM package WHERE package_id=? AND plant=?", b["package_id"], c.plant)
    if not pk or pk["state"] == "REJECTED":
        raise MesError("PACKAGE_NOT_FOUND", b["package_id"])
    x = _completion(c, pk["completion_id"])
    import json
    current = get_open_order(c.conn, c.plant, x["order_no"])
    o = json.loads(x["order_snapshot"])
    if current["source_version"] != o["source_version"]:
        raise MesError("ORDER_VERSION_CHANGED")
    need_shift(b["shift"])
    check_sloc_not_asrs(c.plant, b["storage_location"], plant_cfg(c.plant).get("gr_asrs_sloc_allowed"))
    packs, loose = int_str(b["actual_packages"]), int_str(b["loose_pieces"])
    rate = pieces_per(c.conn, c.plant, o, pk["package_uom"])
    pieces = packs * rate + loose
    used = one(c.conn, "SELECT COALESCE(SUM(pieces),0) s FROM receipt WHERE package_id=? AND state NOT IN ('REJECTED')", pk["package_id"])["s"]
    if pieces <= 0 or used + pieces > pk["pieces"]:
        raise MesError("RECEIPT_EXCEEDS_PACKAGE", f"{used}+{pieces}>{pk['pieces']}")
    qty, uom = (str(packs), pk["package_uom"]) if loose == 0 else (str(pieces), "EA")
    rid, gr = new_id(), new_id()
    body = _cmd_base(c, b, x["completion_id"]) | {
        "package_id": pk["package_id"], "receipt_id": rid, "gr_txn_id": gr, "actual_packages": str(packs), "loose_pieces": str(loose),
        "receipt": {"quantity": qty, "uom": uom, "storage_location": b["storage_location"]},
        "posting_date": b["posting_date"], "shift": b["shift"], "order_version": o["source_version"], "source_ref": "GR-" + rid}
    c.conn.execute("INSERT INTO receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'QUEUED',NULL,?)",
                   (rid, c.plant, x["completion_id"], pk["package_id"], gr, packs, loose, pieces, qty, uom, b["storage_location"], b["posting_date"], b["shift"], now()))
    c.track_txn(gr, "GOODS_RECEIPT", "receipt", rid)
    msg = c.enqueue("submit_receipt", body, "receipt", rid, depends_on=c.msg_for("package", pk["package_id"]))
    return {"receipt_id": rid, "gr_txn_id": gr, "quantity": qty, "uom": uom, "pieces": pieces, "outbox_msg": msg}


@action("decide_receipt", roles=("WH",), required=("receipt_id", "decision", "actor", "evidence_ref"))
def decide_receipt(c, b):
    """Kho duyệt/từ chối phiếu nhập kho DRAFT. REJECT bắt buộc reason."""
    r = one(c.conn, "SELECT * FROM receipt WHERE receipt_id=? AND plant=?", b["receipt_id"], c.plant)
    if not r:
        raise MesError("RECEIPT_NOT_FOUND", b["receipt_id"])
    if r["state"] not in ("QUEUED", "DRAFT"):
        raise MesError("RECEIPT_NOT_DRAFT", r["state"])
    if b["decision"] not in ("APPROVE", "REJECT"):
        raise MesError("INVALID_DECISION", b["decision"])
    body = _cmd_base(c, b, r["completion_id"]) | {"receipt_id": r["receipt_id"], "decision": b["decision"]}
    if b["decision"] == "REJECT":
        if not b.get("reason"):
            raise MesError("REJECTION_REASON_REQUIRED")
        body["reason"] = b["reason"]
    c.conn.execute("UPDATE receipt SET state='DECISION_QUEUED' WHERE receipt_id=? AND plant=?", (r["receipt_id"], c.plant))
    msg = c.enqueue("decide_receipt", body, "receipt_decision", r["receipt_id"], depends_on=c.msg_for("receipt", r["receipt_id"]))
    return {"receipt_id": r["receipt_id"], "decision": b["decision"], "outbox_msg": msg}
