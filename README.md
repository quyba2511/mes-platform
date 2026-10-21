# MES Foundation — đa nhà máy, sản xuất rời rạc

**Trạng thái: nền tảng triển khai ban đầu, chưa được nghiệm thu production.** Đây là ứng dụng có backend, cơ sở dữ liệu, phân quyền và giao dịch nghiệp vụ; không phải dashboard tĩnh. Chưa có kết nối nhà máy thực tế. Không tuyên bố chứng nhận ISA-95 hoặc tương thích mọi doanh nghiệp.

## Phạm vi hiện có

- Một doanh nghiệp, nhiều nhà máy; quyền planner/operator/quality/viewer theo nhà máy; quản trị viên cấp doanh nghiệp.
- Quy trình và BOM có phiên bản bất biến. Mỗi lệnh lưu phiên bản và bản chụp công đoạn.
- Nhập lô vật tư → cách ly → quyết định QC → cấp đúng BOM khi phát hành lệnh.
- Lệnh nháp → phát hành → ghi nhận từng công đoạn → QC cuối → đóng lệnh.
- Giữ lệnh, quyết định xử lý, kiểm tra lại; giới hạn sản lượng; giảm đầu vào công đoạn sau theo số lượng đạt.
- Truy xuất lô nguyên liệu → lệnh và chiều ngược lại. Mã lệnh + nhà máy định danh lô thành phẩm logic.
- Nhật ký append-only; version chống ghi đè; Idempotency-Key cho tạo lệnh và thao tác lệnh; transactional outbox lưu sự kiện cùng giao dịch.
- Giao diện tiếng Việt, tìm/lọc lệnh, chuyển nhà máy, ghi nhận thực tế, xem nguồn gốc và nhật ký.

**Giới hạn nghiệp vụ:** chỉ số nguyên pcs, công đoạn tuần tự xử lý hết đầu vào rồi chuyển tiếp; xuất toàn bộ vật tư theo định mức khi phát hành. Chưa có hoàn vật tư, sửa số liệu bằng bút toán đảo, hủy lệnh, rework, thay thế vật tư, serial từng chiếc, chia/gộp lô, tồn kho thành phẩm độc lập, APS, bảo trì, OEE, SPC hoặc tích hợp ERP/PLC. Không được dùng để vận hành nhà máy cần các quy trình này trước khi bổ sung và nghiệm thu.

## Chạy thử trên máy cá nhân

Yêu cầu Python 3.12. Từ thư mục dự án:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.manage init-db
python -m app.manage demo
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Mở http://127.0.0.1:8000. Lệnh `demo` in mật khẩu ngẫu nhiên của tài khoản `demo`, tạo hai nhà máy HN/BD, quy trình ASM-100 và vật tư mẫu. Không có mật khẩu mặc định chung. Demo không chạy khi MES_ENV=production. Cơ sở dữ liệu SQLite chỉ dùng kiểm thử cục bộ, không dùng production. Dữ liệu mẫu không đại diện sản lượng nhà máy thật.

Luồng kiểm thử bằng giao diện:

1. Đăng nhập → chọn nhà máy → Lệnh sản xuất → Tạo lệnh, chọn ASM-100 R1, số lượng 10.
2. Phát hành: cấp 10 HOUSING và 40 BOLT từ các lô đã duyệt.
3. Ghi nhận 10 đạt ở từng công đoạn, chọn “Kết thúc công đoạn”.
4. Ghi biên bản kiểm tra cuối với kết quả Đạt; đóng lệnh.
5. Mở Truy xuất nguồn gốc và Nhật ký hoạt động. Chuyển nhà máy để kiểm tra dữ liệu được tách biệt.

## Kiểm thử

```sh
python -m pytest -q
node --check app/static/app.js
```

Xem [docs/verification.md](docs/verification.md) để phân biệt kiểm thử đã chạy và các kiểm thử còn thiếu. Bộ kiểm thử kiểm tra nghiệp vụ, quyền nhà máy, xử lý trùng, rollback vật tư, phiên bản, xung đột đồng thời, nhật ký bất biến và vòng đời QC.

## Chuẩn bị PostgreSQL / Docker

Tệp Compose là cấu hình khởi đầu cho môi trường nghiệm thu một máy chủ, **không phải hệ thống HA đã hoàn thiện**. Docker/PostgreSQL chưa chạy trong môi trường tạo dự án.

```sh
cp .env.example .env
# Thay mật khẩu ngẫu nhiên và DATABASE_URL tương ứng trong .env.
# Mật khẩu dùng trong URL cần percent-encode nếu có ký tự đặc biệt.
docker compose up -d db
docker compose build app
docker compose run --rm app python -m app.manage init-db
docker compose run --rm -it app python -m app.manage create-user admin --admin
docker compose run --rm app python -m app.manage create-plant HN "Nhà máy Hà Nội"
docker compose run --rm app python -m app.manage create-plant BD "Nhà máy Bình Dương"
docker compose up -d app
```

Không commit `.env`. App chỉ bind cổng host ở 127.0.0.1. Đặt reverse proxy HTTPS phía trước trước khi cho người khác truy cập. Đặt MES_ALLOWED_HOSTS đúng tên miền. Cần tách tài khoản migrate/DB owner khỏi tài khoản ứng dụng trước production; tài khoản `mes` của Compose mặc định sở hữu database chỉ dành giai đoạn nghiệm thu.

Tạo người dùng theo vai trò:

```sh
python -m app.manage create-user operator01
python -m app.manage grant operator01 HN operator
```

Lệnh quản trị yêu cầu quyền truy cập hạ tầng, phải có nhật ký thay đổi hạ tầng riêng. App không có giao diện quản trị người dùng, SSO/MFA hoặc quy trình quản lý quyền đầy đủ ở phiên bản này.

## Tài liệu

- [Kiến trúc và phạm vi chuẩn tham chiếu](docs/architecture.md)
- [Ma trận nghiệm thu trước production](docs/production-readiness.md)
- [API và giao dịch](docs/api.md)
- [Kết quả xác minh](docs/verification.md)

API tương tác tại `/api/docs`, OpenAPI tại `/api/openapi.json`. `/health/live` kiểm tra tiến trình; `/health/ready` kiểm tra kết nối và schema. Không tự nâng cấp schema khi khởi động web.
