"""Giả lập 中介庫 tối thiểu để test MES app không cần SQL Server.
Mô phỏng: idempotency (duplicate:true / *_CONFLICT), event queue claim/ack + lease, BUSINESS_RESULT, TXN_RESULT,
vài kiểm tra chính (GRADE_BALANCE_MISMATCH, RESERVATION_REQUIRED, ASRS_MANAGED_SLOC, AY_PAIR_MISSING).
KHÔNG thay thế test trên DB UAT thật (tests/run_tests.sh của gói v2.1)."""
import copy
import json
import uuid

from app.fuburg.intf_client import IntfError


def U():
    return str(uuid.uuid4()).upper()


class FakeIntf:
    def __init__(self):
        self.events = []          # {event_id, event_type, payload, state, token}
        self.seen = {}            # key → canonical body
        self.txn = {}             # txn_id → state
        self.calls = []           # (action, body)
        self.fail_next = {}       # action → [code,...]  (ném lỗi trước khi xử lý)
        self.lose_reply = set()   # action: xử lý xong rồi "mất kết nối"

    # ---- phía SAP (helper cho test)
    def publish_order(self, body, site="TW_MAIN", ay=None, rate=None):
        p = copy.deepcopy(body)
        p["site"] = site
        p["ay_materials"] = [{"ay_material": a} for a in (ay or [])]
        p["order_uom_rate"] = rate
        self._emit("ORDER", p)

    def sap_post(self, txn_id, state="POSTED"):
        self.txn[txn_id] = state
        self._emit("TXN_RESULT", {"plant": "1011", "txn_id": txn_id, "claim_token": U(), "state": state, "documents": [], "messages": []})

    def _emit(self, t, p):
        self.events.append({"event_id": U(), "event_type": t, "payload": p, "state": "PENDING", "token": None})

    # ---- intf.api
    def call(self, action, body):
        self.calls.append((action, copy.deepcopy(body)))
        if self.fail_next.get(action):
            raise IntfError(self.fail_next[action].pop(0))
        res = getattr(self, "a_" + action)(body)
        if action in self.lose_reply:
            self.lose_reply.discard(action)
            raise IntfError("TRANSPORT", "connection reset after commit")
        return res

    def _idem(self, key, body, conflict):
        c = json.dumps(body, sort_keys=True)
        if key in self.seen:
            if self.seen[key] != c:
                raise IntfError(conflict)
            return True
        self.seen[key] = c
        return False

    def a_claim_delivery(self, b):
        ev = [e for e in self.events if e["state"] == "PENDING"][: b.get("limit", 50)]
        if not ev:
            return {}
        tok = U()
        for e in ev:
            e["state"], e["token"] = "LEASED", tok
        return {"events": [{"event_id": e["event_id"], "claim_token": tok, "event_type": e["event_type"], "payload": e["payload"]} for e in ev]}

    def a_ack_delivery(self, b):
        e = next(e for e in self.events if e["event_id"] == b["event_id"])
        if e["state"] != "LEASED" or e["token"] != b["claim_token"]:
            raise IntfError("STALE_DELIVERY_TOKEN")
        e["state"] = "ACKED"
        return {"acked": True, "event_id": e["event_id"]}

    def expire_leases(self):
        for e in self.events:
            if e["state"] == "LEASED":
                e["state"], e["token"] = "PENDING", None

    def a_submit_completion(self, b):
        if self._idem(b["completion_id"], b, "SOURCE_CONFLICT_REQUIRES_SAP_CORRECTION"):
            return {"accepted": True, "duplicate": True, "completion_id": b["completion_id"]}
        g = sum(int(x["pieces"]) for x in b["grades"] if x["disposition"] == "GOOD")
        s = sum(int(x["pieces"]) for x in b["grades"] if x["disposition"] == "SCRAP")
        if g != int(b["good_pieces"]) or s != int(b["scrap_pieces"]):
            del self.seen[b["completion_id"]]
            raise IntfError("GRADE_BALANCE_MISMATCH")
        self.txn[b["pp_txn_id"]] = "PENDING"
        return {"accepted": True, "sap_posted": False, "completion_id": b["completion_id"], "pp_txn_id": b["pp_txn_id"], "state": "PENDING"}

    def _cmd(self, action, b, result):
        if self._idem(b["command_id"], b, "COMMAND_CONFLICT"):
            return dict(result, duplicate=True)
        if b["completion_id"] not in self.seen:
            del self.seen[b["command_id"]]
            raise IntfError("COMPLETION_NOT_FOUND")
        self._emit("BUSINESS_RESULT", dict(result, completion_id=b["completion_id"], action=action))
        return result

    def a_release_quality(self, b):
        return self._cmd("release_quality", b, {"accepted": True, "release_id": b["release_id"], "released_pieces": int(b["pieces"])})

    def a_record_packaging(self, b):
        return self._cmd("record_packaging", b, {"accepted": True, "package_id": b["package_id"]})

    def a_submit_receipt(self, b):
        if b["receipt"]["storage_location"].startswith("2"):
            raise IntfError("ASRS_MANAGED_SLOC")
        r = self._cmd("submit_receipt", b, {"accepted": True, "receipt_id": b["receipt_id"], "business_state": "DRAFT"})
        self.txn.setdefault(b["gr_txn_id"], "PENDING")
        return r

    def a_decide_receipt(self, b):
        return self._cmd("decide_receipt", b, {"accepted": True, "receipt_id": b["receipt_id"], "decision": b["decision"]})

    def a_submit_goods_movement(self, b):
        if self._idem(b["movement_id"], b, "SOURCE_CONFLICT"):
            return {"accepted": True, "duplicate": True, "movement_id": b["movement_id"]}
        try:
            if b["purpose"] == "CONSUMPTION" and any(not i.get("reservation_no") for i in b["items"]):
                raise IntfError("RESERVATION_REQUIRED")
            if b["purpose"] == "AY_RECEIPT" and not any(i["movement_type"] == "531" for i in b["items"]):
                raise IntfError("AY_PAIR_MISSING")
        except IntfError:
            del self.seen[b["movement_id"]]
            raise
        self.txn[b["txn_id"]] = "PENDING"
        return {"accepted": True, "movement_id": b["movement_id"], "txn_id": b["txn_id"], "state": "PENDING"}

    def a_cancel_txn(self, b):
        if self.txn.get(b["txn_id"]) not in ("PENDING", "APPROVED", "FAILED"):
            raise IntfError("TXN_NOT_CANCELLABLE")
        self.txn[b["txn_id"]] = "CANCELLED"
        self._emit("TXN_RESULT", {"txn_id": b["txn_id"], "state": "CANCELLED", "message": b["reason"]})
        return {"accepted": True, "txn_id": b["txn_id"], "state": "CANCELLED"}
