# Điều kiện nghiệm thu trước khi vận hành thật

Đây là danh sách công việc chưa hoàn tất, không phải tuyên bố sản phẩm đã sẵn sàng production. Chủ sở hữu hệ thống phải chốt yêu cầu và nghiệm thu các mục phù hợp với nhà máy.

| Nhóm | Điều kiện nghiệm thu | Trạng thái bản đầu |
|---|---|---|
| Nghiệp vụ | Chủ quy trình duyệt luồng lệnh, QC, cấp vật tư, xử lý thiếu/hỏng | Chưa có chủ quy trình nghiệm thu |
| PostgreSQL | Chạy bộ test, xung đột đồng thời, trigger, constraint trên database đích | Chưa chạy trong môi trường tạo dự án |
| Thiết bị thực | Chốt mã máy, giao thức, mapping, tín hiệu nguồn và hiệu chỉnh | Chưa kết nối |
| ERP | Định nghĩa nguồn master, đồng bộ đơn hàng/BOM/thành phẩm, xử lý trùng | Chưa tích hợp |
| Danh tính | SSO/MFA hoặc chính sách mật khẩu, khóa tài khoản, thu hồi/quy trình cấp quyền | Chỉ có mật khẩu, phiên 8h và CLI cấp quyền |
| Phân quyền | Kiểm tra ma trận quyền thực tế, nhiều vai trò, phân tách phê duyệt | Vai trò đơn theo nhà máy đã có kiểm thử |
| Database | Tách migration owner và runtime role; TLS DB; hạn chế mạng | Compose chưa tách role |
| Lịch sử | Mục tiêu retention, lưu độc lập/WORM nếu cần, theo dõi quản trị DB | Trigger bất biến; DB owner vẫn có quyền đặc biệt |
| Vận hành | Log tập trung, metric, alert, on-call, readiness và rolling release | Chỉ health endpoints và log máy chủ cơ bản |
| Sao lưu | Chốt RPO/RTO, backup mã hóa, lịch retention và diễn tập restore | Chưa cấu hình/diễn tập |
| Khôi phục lỗi | Mất điện, mất mạng, gửi lại, lỗi máy, rollback triển khai | API chống trùng; chưa có offline queue |
| Hiệu năng | Chốt số nhà máy/người dùng/lệnh/ngày, thử tải và soak test | Chưa có tải mục tiêu hoặc kết quả tải |
| Nâng cấp schema | Migration có phiên bản, rehearsal, backward compatibility | Chỉ migration khởi tạo v1, chưa có nâng cấp v2 |
| Chất lượng sản phẩm | UAT có ký nhận, kế hoạch rollback và hỗ trợ sau go-live | Chưa thực hiện |

## Mở rộng nghiệp vụ cần chọn trước pilot

- Có cho chuyển một phần sang công đoạn sau trước khi hoàn tất cả lô?
- Có serial từng sản phẩm, split/merge lô hoặc xuất thành phẩm nhiều lô?
- Phế phẩm có cần duyệt, có rework hoặc trả về công đoạn trước?
- Vật tư cấp thực tế hay backflush theo định mức? Có thay thế, trả lại, chênh lệch?
- Quy trình/BOM có cần chữ ký phê duyệt và ngày hiệu lực?
- QC kiểm theo mẫu hay 100%; cần giới hạn đo và lưu bằng chứng nào?
- Một thiết bị dùng nhiều lệnh đồng thời? Theo dõi ca, downtime, OEE thế nào?
- Khi mất mạng, trạm có được chạy tiếp không và ai giải quyết xung đột đồng bộ?

## Runbook tối thiểu cần hoàn thiện

1. Trước release: backup có thể phục hồi; kiểm thử migration trên bản sao; chạy CI và UAT.
2. Sau release: kiểm tra readiness, login, một luồng nghiệp vụ mẫu không đụng sản lượng thật, giám sát lỗi.
3. Sự cố dữ liệu: dừng thao tác có ảnh hưởng, giữ audit và log, phân tích bằng bản sao. Không sửa trực tiếp audit để che lỗi.
4. Rollback: xác định tương thích schema trước khi quay lại image trước; không giả định rollback code tự rollback dữ liệu.
5. Khôi phục: restore sang database mới, đối chiếu vật tư/công đoạn/audit, xác nhận với nhà máy trước mở ghi lại.

## Bảo mật triển khai

Chỉ công bố qua HTTPS. API token giữ trong bộ nhớ trình duyệt, không ghi localStorage; reload cần đăng nhập lại. Session token được hash trong DB và hết hạn sau 8 giờ. Mật khẩu PBKDF2-SHA256 600.000 vòng, salt ngẫu nhiên. Login có giới hạn số lần thất bại theo tên tài khoản; cần thêm giới hạn tại reverse proxy theo nguồn kết nối để chống tiêu hao tài nguyên. Không coi tính năng này là MFA/SSO.

Runtime database user không được superuser, quyền CREATE/ALTER/DROP/TRUNCATE hoặc sửa/xóa audit/routes. Migration dùng role riêng. Tệp Compose hiện dùng owner đơn để dễ nghiệm thu, phải thay trước production. DBA vẫn là tài khoản đặc quyền; nếu cần chứng cứ chống chỉnh sửa bởi DBA, phải lưu audit sang hệ thống độc lập có chính sách bảo toàn.

Không thêm kết nối PLC ghi/điều khiển cho đến khi có thiết kế OT và nghiệm thu an toàn riêng. Lõi hiện không gửi lệnh điều khiển thiết bị.
