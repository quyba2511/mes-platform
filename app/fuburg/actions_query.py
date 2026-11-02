"""Action chỉ đọc – không ghi audit, không tạo giao dịch."""
from __future__ import annotations

import json

from .core import ACTIONS, MesError, action, one, rows


@action("get_order", roles=("MES", "QA", "WH", "LEAD"), readonly=True, required=("order_no",))
def get_order(c, b):
    """Chi tiết 1 lệnh: header, components (reservation), AY được phép."""
    o = one(c.conn, "SELECT * FROM work_order WHERE plant=? AND order_no=?", c.plant, b["order_no"])
    if not o:
        raise MesError("ORDER_NOT_FOUND", b["order_no"])
    o.pop("payload")
    o["components"] = rows(c.conn, "SELECT reservation_no,reservation_item,material,issue_uom,required_qty,storage_location,backflush FROM order_component WHERE plant=? AND order_no=? ORDER BY reservation_item", c.plant, b["order_no"])
    o["ay_materials"] = [r["ay_material"] for r in rows(c.conn, "SELECT ay_material FROM order_ay WHERE plant=? AND order_no=?", c.plant, b["order_no"])]
    return o


@action("list_orders", roles=("MES", "QA", "WH", "LEAD"), readonly=True)
def list_orders(c, b):
    """Lệnh đang mở (released, chưa closed/deleted); lọc theo site nếu có."""
    sql = "SELECT order_no, source_version, material, description, order_uom, planned_qty, planned_pieces, site, main_work_center, planned_start FROM work_order WHERE plant=? AND released=1 AND closed=0 AND deleted=0"
    args = [c.plant]
    if b.get("site"):
        sql += " AND site=?"
        args.append(b["site"])
    return {"orders": rows(c.conn, sql + " ORDER BY planned_start, order_no", *args)}


@action("get_completion", roles=("MES", "QA", "WH", "LEAD"), readonly=True, required=("completion_id",))
def get_completion(c, b):
    """Số dư cục bộ của 1 báo công (good → release → package → receipt) + trạng thái SAP. Đối chiếu với intf completion_balance."""
    x = one(c.conn, "SELECT * FROM completion WHERE completion_id=? AND plant=?", b["completion_id"], c.plant)
    if not x:
        raise MesError("COMPLETION_NOT_FOUND")
    s = lambda sql: one(c.conn, sql, x["completion_id"])["s"]  # noqa: E731
    x["released_pieces"] = s("SELECT COALESCE(SUM(pieces),0) s FROM release_lot WHERE completion_id=? AND state<>'REJECTED'")
    x["packaged_pieces"] = s("SELECT COALESCE(SUM(pieces),0) s FROM package WHERE completion_id=? AND state<>'REJECTED'")
    x["receipt_pieces"] = s("SELECT COALESCE(SUM(pieces),0) s FROM receipt WHERE completion_id=? AND state NOT IN ('REJECTED')")
    x["receipts"] = rows(c.conn, "SELECT receipt_id, gr_txn_id, quantity, uom, state FROM receipt WHERE completion_id=?", x["completion_id"])
    x["sap"] = rows(c.conn, "SELECT txn_id, txn_type, sap_state FROM txn_ref WHERE ref_id=? OR ref_id IN (SELECT receipt_id FROM receipt WHERE completion_id=?)", x["completion_id"], x["completion_id"])
    return x


@action("outbox_status", roles=("MES", "QA", "WH", "LEAD", "SYNC"), readonly=True)
def outbox_status(c, b):
    """Đếm theo trạng thái + liệt kê message lỗi (FAILED/BLOCKED) để người dùng xử lý."""
    cnt = {r["state"]: r["n"] for r in rows(c.conn, "SELECT state, COUNT(*) n FROM outbox WHERE plant=? GROUP BY state", c.plant)}
    bad = rows(c.conn, "SELECT seq, msg_id, intf_action, ref_kind, ref_id, state, attempts, last_error FROM outbox WHERE plant=? AND state IN ('FAILED','BLOCKED','RETRY') ORDER BY seq", c.plant)
    return {"counts": cnt, "problems": bad}


@action("list_actions", roles=("MES", "QA", "WH", "LEAD", "SYNC"), readonly=True)
def list_actions(c, b):
    """Danh mục action (tự mô tả) – UI có thể dùng để sinh menu/kiểm quyền."""
    return {"actions": [{"action": a.name, "roles": a.roles, "readonly": a.readonly, "required": a.required, "doc": a.doc.split("\n")[0]} for a in ACTIONS.values() if a.name != "ingest_event" and (c.role == "ADMIN" or c.role in a.roles or (c.role == "VIEWER" and a.readonly))]}
