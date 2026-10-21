# API và giao dịch

Tất cả `/api/plants/*` yêu cầu `Authorization: Bearer <session-token>`. Quyền được kiểm tra trước đọc dữ liệu. Server không tin role hoặc plant do client tự gán. `/api/docs` và OpenAPI mô tả schema công khai, không chứa dữ liệu nghiệp vụ.

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | /api/login | Đăng nhập bằng username/password |
| POST | /api/logout | Thu hồi token hiện tại |
| GET | /api/plants | Nhà máy người dùng có quyền |
| GET / POST | /api/plants/{plant}/routes | Xem / tạo phiên bản quy trình và BOM |
| GET / POST | /api/plants/{plant}/lots | Xem / nhận lô vật tư |
| POST | /api/plants/{plant}/lots/{lot}/quality | Quyết định QC lần đầu |
| GET | /api/plants/{plant}/lots/{lot}/where-used | Các lệnh sử dụng lô |
| GET / POST | /api/plants/{plant}/orders | Xem / tạo lệnh |
| POST | /api/plants/{plant}/orders/{order}/actions | Thực hiện thao tác lệnh |
| GET | /api/plants/{plant}/orders/{order}/trace | Lô đầu vào và lịch sử lệnh |
| GET | /api/plants/{plant}/audit?before_id=... | 100 sự kiện; cursor giảm dần |

## Ghi lệnh an toàn

POST tạo lệnh và POST actions phải gửi `Idempotency-Key` duy nhất (8–80 ký tự), thường UUID. Dùng lại đúng khóa và body khi retry do mất kết nối. Không tạo khóa mới khi không biết yêu cầu trước đã được commit hay chưa. Server trả lại snapshot kết quả đã lưu cho cùng key/body/path/user; dùng cùng key với payload khác trả 409.

Actions yêu cầu version đang đọc. Server tăng version bằng cập nhật có điều kiện; chỉ một writer thắng. Nếu nhận 409 do phiên bản cũ, tải lại lệnh và để người vận hành xác nhận ý định trước gửi yêu cầu mới. Các lỗi nghiệp vụ rollback cả version, vật tư, công đoạn và audit. API không cho sửa hoặc xóa sự kiện lịch sử.

Các POST route/lot có mã duy nhất và constraint chống trùng nhưng chưa hỗ trợ replay snapshot như order actions. Nếu mất kết nối sau ghi, tra cứu mã trước thử lại; không giả định lỗi mạng đồng nghĩa không lưu.

## Actions

- release: version, allocations[{lot_id, quantity}]. Mỗi lô xuất hiện một lần. Tổng theo mã vật tư phải bằng BOM × planned_qty.
- record: version, operation_id, good, scrap, finish, reason. Nếu scrap > 0 thì bắt buộc reason. finish chỉ thành công khi tổng đạt + phế bằng đầu vào.
- hold: version, reason. Planner/operator/quality được giữ lệnh đang chạy hoặc đã phát hành.
- resume: version, reason. Chỉ quality/admin; reset QC về pending.
- quality: version, decision pass/fail, reason. Chỉ sau khi mọi công đoạn hoàn tất.
- complete: version, reason khi thiếu thành phẩm so với kế hoạch. Chỉ planner/admin, yêu cầu QC pass.

## Outbox

Mỗi audit nghiệp vụ ghi một outbox event trong cùng transaction. Bản đầu không có dispatcher; `delivered_at` luôn chưa đặt. Không thông báo đã đồng bộ ERP. Khi phát triển dispatcher, dùng khóa/lease đa worker, delivery at-least-once, event ID ổn định làm dedup key phía nhận, retry có backoff và dead-letter. Không gọi dịch vụ bên ngoài trong transaction cập nhật sản lượng.

## Giới hạn

Danh sách orders giới hạn 500 bản ghi gần nhất, routes/lots chưa phân trang. Không có WebSocket, streaming thiết bị, time-series telemetry hoặc offline browser queue. Cần bổ sung trước triển khai với quy mô vượt mức thử nghiệm.
