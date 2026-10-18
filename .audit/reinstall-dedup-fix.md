# 重装重复上传修复（2026-09-03）

## 已确认原因

- 用户安装的是 0.5.3 ZIP。该包只有上传接口，没有下载恢复，卸载后上传游标随本地数据丢失。
- 线上 `POST /whatsapp/sync/download` 在排查时返回 404，恢复功能尚未生效。
- 旧请求中的用户名为 `kkflow01`，本次用户填写 `kkflow`；这两者是不同空间，不能假设属于同一操作员并静默合并。
- 服务端旧逻辑用客户端 messageKey 去重，别名会话归并后没有按原始消息 ID 查重。本地模拟已复现同一消息存两条。

## 本次修复

1. 操作员用户名 + 联系人号码；没有号码则使用规范化联系人名称，不含头像。前后端使用相同 v2 身份算法并验证固定样例。
2. 服务器对新协议会话自行计算身份，旧会话优先复用历史 ID。无手机号也能按名称找到旧会话。
3. 上传事务先锁定账号行，再查询同会话的原始消息 ID；复用历史 key，新增消息由服务器生成 key，同一批重复只算一次新增。
4. 本地旧 ID、标签备注、SOP、AI 会话记录和已上传进度迁移；跨 IndexedDB/local storage 的迁移有恢复日志。
5. 插件强制先恢复再上传，服务端下载响应必须支持 schemaVersion 9，否则阻止上传。
6. 保存账号前显示完整配置，勾选核对后才允许确认保存和同步。

## 部署（在 nest-vue-admin 仓库根目录执行）

```bash
pnpm --dir apps/server db:deploy
pnpm --dir apps/server db:g:prod
pnpm --dir apps/server build
pnpm --dir apps/server pm2:reload
```

新 migration 仅增加 `wa_message_identity_idx` 普通索引，不清理线上已有重复数据；不要直接给存量表加唯一索引或盲目删除记录。

服务端部署完成后更新新 ZIP，刷新 WhatsApp 页面，填写准确的原账号并确认同步。不要再使用 0.5.3 / 旧 0.5.4 ZIP。已有跨用户名或同名无号码数据需要单独核对，本次未自动跨账号合并、未删除线上数据。

## 验证与发布

- 插件：39 个测试文件、137 项测试通过，TypeScript 检查通过。
- 服务端：WhatsApp 同步与合作相关 12 个测试套件、130 项测试通过；Prisma schema 校验和生产构建通过。
- 已生成 `.output/kkfans-whatsapp-chat-toolkit-0.5.5-chrome.zip`，ZIP 内包含恢复接口、schemaVersion 9 和 v2 身份迁移逻辑。
- 本次仅本地修改、模拟测试与打包；未执行生产迁移、部署或存量数据清理。
