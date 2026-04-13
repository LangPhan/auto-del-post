import { useEffect, useState } from "react";

export const APP_TOKEN_KEY = "fb-app-token";
export const APP_DEVICE_ID_KEY = "fb-device-id";

export default function SettingsTool() {
  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    chrome.storage.local.get([APP_TOKEN_KEY, APP_DEVICE_ID_KEY]).then((res) => {
      if (res[APP_TOKEN_KEY]) setToken(res[APP_TOKEN_KEY]);
      
      if (res[APP_DEVICE_ID_KEY]) {
        setDeviceId(res[APP_DEVICE_ID_KEY]);
      } else {
        const newDeviceId = crypto.randomUUID();
        setDeviceId(newDeviceId);
        chrome.storage.local.set({ [APP_DEVICE_ID_KEY]: newDeviceId });
      }
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ [APP_TOKEN_KEY]: token.trim() });
    
    setIsValidating(true);
    setStatus(null);
    chrome.runtime.sendMessage(
      { type: "VALIDATE_LICENSE", token: token.trim(), deviceId },
      (res) => {
        setIsValidating(false);
        if (res.success && res.data?.valid) {
          setStatus({ type: "success", msg: "Token hợp lệ! Lượt sử dụng còn lại: " + res.data.usageLimit });
        } else {
          setStatus({ type: "error", msg: "Token không hợp lệ hoặc đã hết hạn (" + (res.data?.reason || res.data?.error || res.error) + ")" });
        }
      }
    );
  };

  return (
    <div className="tool-panel">
      <div className="control-card">
        <h3 style={{ marginBottom: 12 }}>Cài đặt phần mềm</h3>
        <div className="form-group">
          <label htmlFor="appToken">Mã kích hoạt (License Token)</label>
          <input
            id="appToken"
            type="password"
            placeholder="Nhập mã kích hoạt của bạn để sử dụng ứng dụng..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="form-input"
          />
          <span className="form-hint">Mã này bắt buộc để ứng dụng có thể chạy và dọn dẹp bài viết.</span>
        </div>
        
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>ID Thiết Bị Hiện Tại</label>
          <input
            type="text"
            readOnly
            value={deviceId}
            className="form-input"
            style={{ backgroundColor: '#f0f0f0', color: '#666', cursor: 'not-allowed' }}
          />
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button
            className="start-btn"
            onClick={handleSave}
            disabled={isValidating || !token}
          >
            {isValidating ? "Đang kiểm tra..." : "Lưu & Kiểm tra Token"}
          </button>
        </div>

        {status && (
          <div className={`log-entry log-${status.type}`} style={{ marginTop: 16 }}>
            {status.msg}
          </div>
        )}
      </div>
    </div>
  );
}
