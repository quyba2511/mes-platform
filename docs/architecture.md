# Kiến trúc MES đa nhà máy

## Quyết định phạm vi

Yêu cầu đã xác nhận: một doanh nghiệp có nhiều nhà máy, sản xuất lắp ráp/gia công theo công đoạn. Mục tiêu là nền tảng có thể mở rộng theo ngành, không phải một quy trình cố định áp dụng ngay cho mọi doanh nghiệp.

Nguồn tham chiếu: [ISA-95 / IEC 62264](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard) mô tả việc tích hợp các hệ thống doanh nghiệp và vận hành sản xuất; phần 3 đề cập hoạt động quản lý vận hành sản xuất. [ISA-88](https://www.isa.org/standards-and-publications/isa-standards/isa-88-standards) liên quan sản xuất theo mẻ, để dành cho phần mở rộng batch. Đây là tham chiếu cấp kiến trúc từ giới thiệu công khai, không phải bản triển khai đã đối chiếu đầy đủ mọi điều khoản hay được chứng nhận.

## Ranh giới hệ thống

| Lớp | Trách nhiệm dự kiến | Hiện trạng |
|---|---|---|
| ERP / hoạch định doanh nghiệp | Đơn hàng, nhu cầu, kế hoạch tổng, nghiệp vụ tài chính | Chưa tích hợp |
| MES / vận hành | Lệnh, công đoạn, cấp vật tư, QC, truy xuất và lịch sử | Lõi ban đầu đã triển khai |
| SCADA / thiết bị / edge gateway | Thu nhận tín hiệu, chu kỳ, trạng thái máy; store-and-forward | Chưa triển khai |
| PLC / điều khiển | Điều khiển máy, interlock, an toàn thiết bị | Nằm ngoài phạm vi ứng dụng |

MES không thay thế chức năng an toàn hoặc điều khiển thời gian thực của máy.

## Kiến trúc phần mềm

Ứng dụng dạng modular monolith: trình duyệt cùng origin → FastAPI → tầng giao dịch → PostgreSQL. Giao diện dùng JS/CSS không cần bước build. Giao dịch nghiệp vụ được thực hiện trên server. SQLite chỉ là adapter phát triển và kiểm thử.

Phân vùng dữ liệu theo plant_id, kiểm tra quyền từ phiên đăng nhập trên server trước mọi truy cập. Admin có quyền xuyên nhà máy theo chủ đích; các vai trò khác chỉ được truy cập nhà máy có grant. Không nhận vai trò do trình duyệt khai báo. Đây không phải SaaS nhiều doanh nghiệp: chưa có tenant doanh nghiệp và không được ghép dữ liệu nhiều khách hàng độc lập vào bản này.

Để phát triển thêm phân cấp tổ chức: Enterprise → Site → Area → Work Center → Work Unit. Bản đầu chỉ có Site/Plant thật và mã Work Center được lưu trong công đoạn; Area, Work Unit, năng lực và lịch thiết bị chưa là thực thể đầy đủ. Không gọi đó là triển khai trọn bộ phân cấp chuẩn.

## Các miền dữ liệu

| Miền | Thực thể hiện có | Hướng mở rộng |
|---|---|---|
| Tổ chức & danh tính | Plant, User, PlantGrant, Session | Enterprise, Area, SSO, nhóm quyền |
| Định nghĩa sản xuất | Route revision, BOM, step definitions | Product master, work instructions, ký duyệt phát hành, hiệu lực theo ngày |
| Điều hành | WorkOrder, Operation progress | Dispatch, ca làm, năng lực, chuyển lô từng phần |
| Vật tư | MaterialLot, Consumption | UOM, kho/vị trí, reservation, hoàn trả, thay thế |
| Chất lượng | Lot disposition, final order QC | Inspection plan, kết quả đo, NCR/CAPA, rework |
| Truy xuất | Lot → Consumption → Order → logical output lot | Serial, split/merge, nhiều cấp genealogy |
| Tích hợp | Outbox rows | Dispatcher, retry, dead letter, ERP adapters |
| Kiểm toán | AuditEvent bất biến | Kho lưu chống sửa độc lập, retention theo chính sách |

## Quy tắc dữ liệu bắt buộc trong lõi

1. Quy trình đã lưu không update/delete; thay đổi tạo revision mới. Mỗi lệnh gắn đúng revision và sao chép công đoạn.
2. Phát hành lệnh và trừ lượng vật tư diễn ra trong cùng giao dịch. Phải cấp đủ và đúng BOM; vật tư thuộc cùng nhà máy, đã được QC duyệt, còn đủ lượng.
3. Chỉ công đoạn đầu nhận số lượng kế hoạch. Mỗi công đoạn sau nhận số lượng đạt của công đoạn trước; phế phẩm không chuyển tiếp.
4. Không ghi nhận vượt đầu vào, không kết thúc công đoạn khi còn số lượng chưa giải trình, không ghi nhận trong lúc lệnh bị giữ hoặc đã đóng.
5. Đóng lệnh cần QC đạt sau khi tất cả công đoạn hoàn tất. Đóng thiếu kế hoạch cần ghi lý do.
6. Mỗi thao tác lệnh mang version và khóa chống trùng. Yêu cầu stale bị từ chối. Cùng khóa/cùng nội dung trả kết quả đã lưu; cùng khóa/khác nội dung bị từ chối.
7. Cập nhật nghiệp vụ, audit và outbox commit/rollback cùng nhau. Outbox hiện chỉ ghi nhận, chưa tự gửi đi đâu.

## Quyền mặc định

| Thao tác | Planner | Operator | Quality | Viewer | Admin |
|---|---|---|---|---|---|
| Xem nhà máy được cấp quyền | Có | Có | Có | Có | Tất cả |
| Tạo quy trình, lệnh, nhập vật tư | Có | — | — | — | Có |
| Phát hành, đóng lệnh | Có | — | — | — | Có |
| Ghi sản lượng | — | Có | — | — | Có |
| Tạm giữ lệnh | Có | Có | Có | — | Có |
| Duyệt QC, bỏ giữ lệnh | — | — | Có | — | Có |

Một người có một vai trò cho mỗi nhà máy trong bản đầu. Quyền quản trị người dùng/nhà máy qua CLI hạ tầng, chưa có workflow phê duyệt trong app.

## Thời gian và định lượng

Lưu dấu thời gian UTC; trình bày theo timezone IANA của nhà máy. Đơn vị định lượng ở bản đầu là pcs nguyên dương, không có kg/lít hoặc chuyển đổi đơn vị. Kết quả báo cáo là snapshot các lệnh đã tải, không phải KPI theo ca hoặc dashboard OEE. Lệnh tối đa 500 bản ghi gần nhất ở endpoint danh sách; cần pagination và chỉ số tổng hợp phía server trước triển khai quy mô lớn.

## Triển khai dự kiến

Một dịch vụ API + PostgreSQL cho giai đoạn đầu, sau đó bổ sung worker outbox và edge gateway độc lập khi yêu cầu tích hợp được xác định. Không đưa microservices vào trước khi có nhu cầu tải hoặc tổ chức vận hành tương ứng. Tách các môi trường development/staging/production và quy trình review/migrate/backup/rollback.

Sản phẩm cần mở rộng bằng các module có giao diện rõ ràng, không bằng việc cho người dùng chạy script tùy ý trong quy trình. Các adapter ERP và thiết bị phải có mapping/version, idempotency và hàng đợi lỗi riêng.
