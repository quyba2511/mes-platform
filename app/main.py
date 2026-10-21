import hashlib
import json
import os
import secrets
from datetime import timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .db import database_url, make_engine
from .models import Audit, Command, Consumption, Grant, LoginAttempt, Lot, Operation, Outbox, Plant, Route, Session, User, WorkOrder, now
from .schemas import ActionInput, LoginInput, LotInput, LotQualityInput, OrderInput, RouteInput
from .security import hash_password, token_hash, verify_password

def require(condition, message, status=409):
    if not condition:
        raise HTTPException(status, message)

def audit(db, user, plant, action, entity, entity_id, payload):
    db.add(Audit(plant_id=plant, actor_id=user.id, action=action, entity=entity, entity_id=entity_id, payload=payload))
    db.add(Outbox(plant_id=plant, topic=action, payload={"entity": entity, "entity_id": entity_id, **payload}))

def order_data(db, order):
    operations = db.scalars(select(Operation).where(Operation.order_id == order.id).order_by(Operation.sequence)).all()
    return {"id": order.id, "plant_id": order.plant_id, "code": order.code, "product": order.product,
            "revision": order.revision, "planned_qty": order.planned_qty, "state": order.state,
            "quality": order.quality, "hold_reason": order.hold_reason, "version": order.version,
            "created_at": order.created_at.isoformat(), "route_id": order.route_id,
            "operations": [{"id": x.id, "sequence": x.sequence, "name": x.name, "work_center": x.work_center,
                            "good": x.good, "scrap": x.scrap, "done": x.done} for x in operations]}

def create_app(engine=None):
    app = FastAPI(title="MES Foundation", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.engine = engine if engine is not None else make_engine(database_url())
    factory = sessionmaker(app.state.engine, expire_on_commit=False)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=os.getenv("MES_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(","))
    dummy_hash = hash_password(secrets.token_urlsafe(32))

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path == "/" or request.url.path.startswith("/static"):
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(IntegrityError)
    async def conflict_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": "Dữ liệu trùng hoặc xung đột. Tải lại trước khi thử lại."})

    def db_session():
        with factory() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def current_user(authorization: str = Header(default=""), db=Depends(db_session, scope="function")):
        require(authorization.startswith("Bearer "), "Vui lòng đăng nhập", 401)
        session = db.get(Session, token_hash(authorization[7:]))
        require(session is not None, "Phiên không hợp lệ", 401)
        expires = session.expires_at.replace(tzinfo=timezone.utc) if session.expires_at.tzinfo is None else session.expires_at
        require(expires > now(), "Phiên đã hết hạn", 401)
        user = db.get(User, session.user_id)
        require(user is not None and user.active, "Tài khoản không hoạt động", 401)
        return user

    def access(db, user, plant_id, roles=None):
        grant = db.scalar(select(Grant).where(Grant.user_id == user.id, Grant.plant_id == plant_id))
        require(user.is_admin or grant is not None, "Không có quyền truy cập nhà máy", 403)
        require(db.get(Plant, plant_id) is not None, "Không tìm thấy nhà máy", 404)
        require(user.is_admin or roles is None or grant.role in roles, "Vai trò không được phép thực hiện thao tác", 403)

    def scoped_order(db, plant_id, order_id):
        order = db.scalar(select(WorkOrder).where(WorkOrder.id == order_id, WorkOrder.plant_id == plant_id))
        require(order is not None, "Không tìm thấy lệnh", 404)
        return order

    def replay(db, user, key, path, payload):
        require(8 <= len(key) <= 80, "Cần Idempotency-Key từ 8 đến 80 ký tự", 400)
        fingerprint = hashlib.sha256(json.dumps({"path": path, "body": payload}, sort_keys=True).encode()).hexdigest()
        saved = db.scalar(select(Command).where(Command.user_id == user.id, Command.key == key))
        if saved:
            require(saved.fingerprint == fingerprint, "Idempotency-Key đã dùng cho yêu cầu khác")
            return fingerprint, saved.response
        return fingerprint, None

    def save_command(db, user, key, fingerprint, response):
        db.add(Command(user_id=user.id, key=key, fingerprint=fingerprint, response=response))
        db.flush()
        return response

    @app.get("/health/live")
    def live():
        return {"status": "ok", "release": "foundation-0.1.0"}

    @app.get("/health/ready")
    def ready(db=Depends(db_session, scope="function")):
        from .models import SchemaVersion
        require(db.get(SchemaVersion, 1) is not None, "Schema chưa khởi tạo", 503)
        return {"status": "ready"}

    @app.post("/api/login")
    def login(data: LoginInput, request: Request, db=Depends(db_session, scope="function")):
        # Database-backed limits survive application worker restarts. Edge rate limits are also required.
        key = token_hash(data.username.lower())
        attempt = db.get(LoginAttempt, key, with_for_update=True)
        timestamp = now()
        if attempt is None:
            attempt = LoginAttempt(key=key, count=0, window_start=timestamp)
            db.add(attempt)
            db.flush()
        start = attempt.window_start.replace(tzinfo=timezone.utc)
        if timestamp - start > timedelta(minutes=15):
            attempt.count, attempt.window_start = 0, timestamp
        require(attempt.count < 10, "Thử đăng nhập quá nhiều. Vui lòng chờ 15 phút.", 429)
        user = db.scalar(select(User).where(User.username == data.username))
        valid = verify_password(data.password, user.password_hash if user else dummy_hash)
        if not valid or not user or not user.active:
            attempt.count += 1
            db.commit()
            raise HTTPException(401, "Tên đăng nhập hoặc mật khẩu không đúng")
        attempt.count = 0
        token = secrets.token_urlsafe(48)
        db.add(Session(token_hash=token_hash(token), user_id=user.id, expires_at=timestamp + timedelta(hours=8)))
        return {"token": token, "username": user.username, "is_admin": user.is_admin}

    @app.post("/api/logout")
    def logout(authorization: str = Header(default=""), user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        session = db.get(Session, token_hash(authorization[7:]))
        if session:
            db.delete(session)
        return {"ok": True}

    @app.get("/api/plants")
    def plants(user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        query = select(Plant).order_by(Plant.code)
        if not user.is_admin:
            query = query.join(Grant, Grant.plant_id == Plant.id).where(Grant.user_id == user.id)
        result = []
        for plant in db.scalars(query):
            grant = db.scalar(select(Grant).where(Grant.plant_id == plant.id, Grant.user_id == user.id))
            result.append({"id": plant.id, "code": plant.code, "name": plant.name, "timezone": plant.timezone,
                           "role": "admin" if user.is_admin else grant.role})
        return result

    @app.get("/api/plants/{plant_id}/routes")
    def routes(plant_id: int, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        return [{"id": r.id, "product": r.product, "revision": r.revision, "name": r.name, "steps": r.steps, "bom": r.bom}
                for r in db.scalars(select(Route).where(Route.plant_id == plant_id).order_by(Route.product, Route.revision))]

    @app.post("/api/plants/{plant_id}/routes", status_code=201)
    def add_route(plant_id: int, data: RouteInput, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id, {"planner"})
        route = Route(plant_id=plant_id, created_by=user.id, **data.model_dump())
        db.add(route)
        db.flush()
        audit(db, user, plant_id, "route.created", "route", route.id, data.model_dump())
        return {"id": route.id}

    @app.get("/api/plants/{plant_id}/lots")
    def lots(plant_id: int, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        return [{"id": lot.id, "code": lot.code, "material": lot.material, "received": lot.received,
                 "available": lot.available, "unit": lot.unit, "quality": lot.quality}
                for lot in db.scalars(select(Lot).where(Lot.plant_id == plant_id).order_by(Lot.id.desc()))]

    @app.post("/api/plants/{plant_id}/lots", status_code=201)
    def add_lot(plant_id: int, data: LotInput, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id, {"planner"})
        lot = Lot(plant_id=plant_id, code=data.code, material=data.material, received=data.quantity, available=data.quantity)
        db.add(lot)
        db.flush()
        audit(db, user, plant_id, "lot.received", "lot", lot.id, data.model_dump())
        return {"id": lot.id}

    @app.post("/api/plants/{plant_id}/lots/{lot_id}/quality")
    def lot_quality(plant_id: int, lot_id: int, data: LotQualityInput, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id, {"quality"})
        lot = db.scalar(select(Lot).where(Lot.id == lot_id, Lot.plant_id == plant_id).with_for_update())
        require(lot is not None, "Không tìm thấy lô", 404)
        require(lot.quality == "quarantine", "Lô đã có quyết định chất lượng")
        changed = db.execute(update(Lot).where(Lot.id == lot_id, Lot.quality == "quarantine").values(quality=data.decision))
        require(changed.rowcount == 1, "Lô đã được cập nhật; hãy tải lại")
        audit(db, user, plant_id, "lot.quality", "lot", lot.id, data.model_dump())
        return {"id": lot.id, "quality": data.decision}

    @app.get("/api/plants/{plant_id}/orders")
    def orders(plant_id: int, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        return [order_data(db, o) for o in db.scalars(select(WorkOrder).where(WorkOrder.plant_id == plant_id).order_by(WorkOrder.id.desc()).limit(500))]

    @app.post("/api/plants/{plant_id}/orders", status_code=201)
    def add_order(plant_id: int, data: OrderInput, request: Request, idempotency_key: str = Header(default=""), user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id, {"planner"})
        fingerprint, saved = replay(db, user, idempotency_key, request.url.path, data.model_dump())
        if saved is not None:
            return saved
        route = db.scalar(select(Route).where(Route.id == data.route_id, Route.plant_id == plant_id))
        require(route is not None, "Quy trình không thuộc nhà máy", 404)
        order = WorkOrder(plant_id=plant_id, product=route.product, revision=route.revision, **data.model_dump())
        db.add(order)
        db.flush()
        for sequence, step in enumerate(route.steps, 1):
            db.add(Operation(order_id=order.id, sequence=sequence, **step))
        db.flush()
        audit(db, user, plant_id, "order.created", "order", order.id, data.model_dump())
        return save_command(db, user, idempotency_key, fingerprint, order_data(db, order))

    @app.get("/api/plants/{plant_id}/orders/{order_id}/trace")
    def trace(plant_id: int, order_id: int, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        order = scoped_order(db, plant_id, order_id)
        inputs = [{"lot_id": l.id, "lot": l.code, "material": l.material, "quantity": c.quantity, "unit": l.unit}
                  for c, l in db.execute(select(Consumption, Lot).join(Lot, Lot.id == Consumption.lot_id).where(Consumption.order_id == order.id))]
        events = [{"id": a.id, "at": a.created_at.isoformat(), "actor": u.username, "action": a.action, "payload": a.payload}
                  for a, u in db.execute(select(Audit, User).join(User, User.id == Audit.actor_id).where(Audit.plant_id == plant_id, Audit.entity == "order", Audit.entity_id == order.id).order_by(Audit.id))]
        return {"order": order_data(db, order), "inputs": inputs, "output_lot": order.code if order.state == "completed" else None, "events": events}

    @app.get("/api/plants/{plant_id}/lots/{lot_id}/where-used")
    def where_used(plant_id: int, lot_id: int, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        lot = db.scalar(select(Lot).where(Lot.id == lot_id, Lot.plant_id == plant_id))
        require(lot is not None, "Không tìm thấy lô", 404)
        return [{"order_id": o.id, "order": o.code, "state": o.state, "quantity": c.quantity}
                for c, o in db.execute(select(Consumption, WorkOrder).join(WorkOrder, WorkOrder.id == Consumption.order_id).where(Consumption.lot_id == lot_id, WorkOrder.plant_id == plant_id))]

    @app.post("/api/plants/{plant_id}/orders/{order_id}/actions")
    def action(plant_id: int, order_id: int, data: ActionInput, request: Request,
               idempotency_key: str = Header(default=""), user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        roles = {"release": {"planner"}, "record": {"operator"}, "hold": {"planner", "operator", "quality"},
                 "resume": {"quality"}, "quality": {"quality"}, "complete": {"planner"}}
        access(db, user, plant_id, roles[data.action])
        fingerprint, saved = replay(db, user, idempotency_key, request.url.path, data.model_dump())
        if saved is not None:
            return saved
        order = scoped_order(db, plant_id, order_id)
        # Claim version before changing inventory or progress; concurrent writers cannot both succeed.
        changed = db.execute(update(WorkOrder).where(WorkOrder.id == order.id, WorkOrder.version == data.version).values(version=WorkOrder.version + 1))
        require(changed.rowcount == 1, "Lệnh đã thay đổi. Tải lại rồi thực hiện lại.")
        db.refresh(order)
        require(order.state != "completed", "Lệnh đã đóng, không thể sửa")
        operations = db.scalars(select(Operation).where(Operation.order_id == order.id).order_by(Operation.sequence)).all()
        before = {"state": order.state, "quality": order.quality, "version": data.version}
        if data.action == "release":
            require(order.state == "draft", "Chỉ phát hành lệnh nháp")
            route = db.get(Route, order.route_id)
            expected = {b["material"]: b["per_unit"] * order.planned_qty for b in route.bom}
            require(len({x.lot_id for x in data.allocations}) == len(data.allocations), "Không được chọn lặp lô")
            totals = {}
            for allocation in sorted(data.allocations, key=lambda x: x.lot_id):
                lot = db.scalar(select(Lot).where(Lot.id == allocation.lot_id, Lot.plant_id == plant_id))
                require(lot is not None, "Lô không thuộc nhà máy", 404)
                require(lot.material in expected, "Vật tư không thuộc BOM")
                consumed = db.execute(update(Lot).where(Lot.id == lot.id, Lot.quality == "released", Lot.available >= allocation.quantity).values(available=Lot.available - allocation.quantity))
                require(consumed.rowcount == 1, "Lô chưa được QC duyệt hoặc không đủ tồn kho")
                totals[lot.material] = totals.get(lot.material, 0) + allocation.quantity
                db.add(Consumption(order_id=order.id, lot_id=lot.id, quantity=allocation.quantity))
            require(totals == expected, "Cấp vật tư phải đúng định mức BOM × số lượng kế hoạch")
            order.state = "released"
        elif data.action == "record":
            require(order.state in {"released", "in_progress"}, "Lệnh chưa sẵn sàng hoặc đang bị giữ")
            operation = next((x for x in operations if x.id == data.operation_id), None)
            require(operation is not None, "Công đoạn không thuộc lệnh", 404)
            require(not operation.done, "Công đoạn đã hoàn tất")
            index = operations.index(operation)
            require(index == 0 or operations[index - 1].done, "Phải hoàn tất công đoạn trước")
            capacity = order.planned_qty if index == 0 else operations[index - 1].good
            require(data.good + data.scrap > 0 or (data.finish and operation.good + operation.scrap == capacity), "Chưa có sản lượng để ghi nhận")
            require(data.scrap == 0 or len(data.reason) >= 3, "Cần lý do phế phẩm")
            require(operation.good + operation.scrap + data.good + data.scrap <= capacity, "Sản lượng vượt số lượng đầu vào")
            operation.good += data.good
            operation.scrap += data.scrap
            if data.finish:
                require(operation.good + operation.scrap == capacity, "Phải ghi nhận đủ số lượng đầu vào trước khi kết thúc công đoạn")
                operation.done = True
            order.state, order.quality = "in_progress", "pending"
        elif data.action == "hold":
            require(order.state in {"released", "in_progress"}, "Không thể giữ lệnh ở trạng thái này")
            require(len(data.reason) >= 3, "Cần lý do giữ lệnh")
            order.state, order.hold_reason = "on_hold", data.reason
        elif data.action == "resume":
            require(order.state == "on_hold", "Lệnh không bị giữ")
            require(len(data.reason) >= 3, "Cần lý do xử lý và cho chạy lại")
            order.state = "in_progress" if any(x.good or x.scrap or x.done for x in operations) else "released"
            order.quality, order.hold_reason = "pending", None
        elif data.action == "quality":
            require(order.state == "in_progress" and all(x.done for x in operations), "Chỉ kiểm tra cuối khi mọi công đoạn hoàn tất và lệnh không bị giữ")
            require(data.decision is not None and len(data.reason) >= 3, "Cần kết quả và biên bản kiểm tra")
            order.quality = data.decision
            if data.decision == "fail":
                order.state, order.hold_reason = "on_hold", data.reason
        elif data.action == "complete":
            require(order.state == "in_progress" and all(x.done for x in operations) and order.quality == "pass", "Cần hoàn tất các công đoạn và QC đạt trước khi đóng")
            require(operations[-1].good == order.planned_qty or len(data.reason) >= 3, "Cần lý do đóng lệnh thiếu sản lượng")
            order.state = "completed"
        db.flush()
        result = order_data(db, order)
        audit(db, user, plant_id, f"order.{data.action}", "order", order.id, {"command": data.model_dump(), "before": before, "after": result})
        return save_command(db, user, idempotency_key, fingerprint, result)

    @app.get("/api/plants/{plant_id}/audit")
    def audit_list(plant_id: int, before_id: int | None = None, user=Depends(current_user, scope="function"), db=Depends(db_session, scope="function")):
        access(db, user, plant_id)
        query = select(Audit, User).join(User, User.id == Audit.actor_id).where(Audit.plant_id == plant_id)
        if before_id:
            query = query.where(Audit.id < before_id)
        return [{"id": a.id, "at": a.created_at.isoformat(), "actor": u.username, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "payload": a.payload}
                for a, u in db.execute(query.order_by(Audit.id.desc()).limit(100))]

    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(static / "index.html")

    return app
