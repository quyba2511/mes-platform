# Kết quả xác minh — 21/10/2026

## Đã chạy

- `python3 -m pytest -q`: **21 passed in 20.15s**, trên SQLite tạm riêng cho từng test.
- `node --check app/static/app.js`: đạt, không lỗi cú pháp.
- Biên dịch metadata SQLAlchemy sang PostgreSQL DDL: đạt, 14 bảng / 20 câu lệnh. Đây chỉ là kiểm tra sinh DDL, không phải chạy PostgreSQL.
- FastAPI khởi động thành công với dữ liệu mẫu trong thư mục làm việc ngoài gói bàn giao.
- Kiểm tra giao diện bằng trình duyệt thật ở chiều rộng khoảng 615 px: đăng nhập, chuyển từ Bình Dương sang Hà Nội, mở lệnh, ghi 5 pcs đạt từ 45 lên 50, xem truy xuất các lô vật tư và sự kiện ghi nhận mới.
- Chụp ảnh `mes-preview.png` bên cạnh gói dự án. Tất cả số liệu trong ảnh là dữ liệu tổng hợp để kiểm thử, không phải dữ liệu doanh nghiệp.

## Các nhóm kiểm thử tự động

1. Vòng đời hoàn chỉnh: phát hành → ba công đoạn → QC → đóng lệnh → truy xuất hai chiều.
2. Tạo lệnh và ghi nhận lại cùng idempotency key không tạo thêm dữ liệu.
3. Cùng khóa nhưng khác nội dung bị từ chối.
4. Version cũ bị từ chối; hai writer đồng thời chỉ một writer thành công.
5. Lỗi BOM rollback vật tư, version, consumption và audit.
6. Lô cách ly, lô/route khác nhà máy, vai trò sai bị từ chối.
7. Không bỏ qua công đoạn, vượt đầu vào hoặc kết thúc khi thiếu số lượng.
8. Phế phẩm giảm lượng chuyển tiếp; đóng lệnh thiếu cần lý do.
9. QC fail giữ lệnh; cần quyết định xử lý và QC lại trước đóng.
10. Trigger chặn update/delete audit và route.
11. Thu hồi phiên logout, xác thực bắt buộc, kiểm tra input, giới hạn login thất bại.
12. Revision mới không thay đổi lệnh cũ; nhập lô và duyệt QC theo trạng thái.
13. Health endpoint, CSP và no-store cho API.

## Chưa xác minh

- Docker build / Docker Compose: máy hiện tại không có Docker.
- Chạy trực tiếp trên PostgreSQL, TLS, backup/restore, migration trên dữ liệu thật.
- Workflow GitHub Actions đã chuẩn bị nhưng chưa được chạy hoặc đẩy lên GitHub. Có hai lượt test SQLite/PostgreSQL; TEST_DATABASE_URL phải trỏ database kiểm thử được phép tạo/xóa schema.
- Toàn bộ luồng trên mọi kích thước màn hình, mọi trình duyệt và công nghệ hỗ trợ tiếp cận.
- Tải nhiều nhà máy/người dùng, lỗi mạng dài hạn, security review độc lập, UAT của nhà máy.
- ERP, PLC, máy quét mã vạch, máy in nhãn, đồng bộ offline hoặc yêu cầu ngành có quản lý đặc thù.

Không sử dụng kết quả SQLite hoặc biên dịch DDL làm bằng chứng hệ thống đã sẵn sàng production.
