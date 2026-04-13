import { ensureContentScript } from '@/utils/query'
import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_STORAGE_KEY = 'fb-graph-api-token'
const GROUP_ID_STORAGE_KEY = 'fb-group-id'

type Mode = 'feed' | 'pending' | 'spam'

interface CleanerConfig {
  keywords: string
  maxPosts: number
  fromDate: string
}

interface LogEntry {
  id: number
  text: string
  type: 'info' | 'success' | 'error' | 'warning'
}

const MODE_META: Record<Mode, { label: string; emoji: string; desc: string }> = {
  feed:    { emoji: '📰', label: 'Bảng tin',    desc: 'Xóa các bài viết khớp từ bảng tin của nhóm' },
  pending: { emoji: '⏳', label: 'Đang chờ', desc: 'Xóa các bài viết khớp từ hàng đợi đang chờ duyệt' },
  spam:    { emoji: '🚫', label: 'Spam',    desc: 'Xóa các bài viết khớp từ thư mục spam / kiểm duyệt viên' },
}

export default function PostCleanerTool() {
  const [mode, setMode] = useState<Mode>('feed')
  const [keywords, setKeywords] = useState('')
  const [maxPosts, setMaxPosts] = useState(5)
  const [fromDate, setFromDate] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [token, setToken] = useState('')
  const [groupId, setGroupId] = useState('')
  const [groupIdLoading, setGroupIdLoading] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const logIdRef = useRef(0)

  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    const id = ++logIdRef.current
    setLogs((prev) => [...prev.slice(-50), { id, text, type }])
  }

  // Listen for progress messages from content script
  useEffect(() => {
    const listener = (message: { type: string; text?: string; logType?: string }) => {
      if (message.type === 'CLEANER_LOG') {
        addLog(message.text ?? '', (message.logType as LogEntry['type']) ?? 'info')
      }
      if (message.type === 'CLEANER_DONE') {
        setRunning(false)
        addLog(message.text ?? 'Tiến trình đã hoàn tất.', 'success')
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Load token and groupId from storage on mount
  useEffect(() => {
    chrome.storage.local.get([TOKEN_STORAGE_KEY, GROUP_ID_STORAGE_KEY]).then((result) => {
      if (result[TOKEN_STORAGE_KEY]) setToken(result[TOKEN_STORAGE_KEY] as string)
      if (result[GROUP_ID_STORAGE_KEY]) setGroupId(result[GROUP_ID_STORAGE_KEY] as string)
    })
  }, [])

  const handleTokenChange = (value: string) => {
    setToken(value)
    chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: value })
  }

  const handleGroupIdChange = (value: string) => {
    setGroupId(value)
    chrome.storage.local.set({ [GROUP_ID_STORAGE_KEY]: value })
  }

  // Auto-detect groupId from current page
  const detectGroupId = useCallback(async () => {
    setGroupIdLoading(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        addLog('Lỗi: Không tìm thấy tab đang hoạt động.', 'error')
        setGroupIdLoading(false)
        return
      }
      if (!tab.url?.includes('facebook.com')) {
        addLog('Lỗi: Vui lòng điều hướng đến trang Facebook trước.', 'error')
        setGroupIdLoading(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Lỗi: Không thể tải mã xử lý (content script).', 'error')
        setGroupIdLoading(false)
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: 'GET_GROUP_ID' }, (response) => {
        setGroupIdLoading(false)
        if (chrome.runtime.lastError) {
          addLog('Lỗi khi phát hiện ID Nhóm: ' + chrome.runtime.lastError.message, 'error')
          return
        }
        if (response?.groupId) {
          setGroupId(response.groupId)
          chrome.storage.local.set({ [GROUP_ID_STORAGE_KEY]: response.groupId })
          addLog(`Đã phát hiện ID Nhóm: ${response.groupId}`, 'success')
        } else {
          addLog('Không thể phát hiện ID Nhóm từ trang này.', 'warning')
        }
      })
    } catch (err) {
      addLog(`Lỗi khi phát hiện ID Nhóm: ${err}`, 'error')
      setGroupIdLoading(false)
    }
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const handleModeChange = (newMode: Mode) => {
    if (running) return
    setMode(newMode)
    setLogs([])
    logIdRef.current = 0
  }

  const handleStart = async () => {
    if (running) return


    if (!groupId.trim()) {
      addLog('Lỗi: Vui lòng nhập hoặc tự động phát hiện ID Nhóm trước.', 'error')
      return
    }

    setRunning(true)
    setLogs([])

    // Validate License Token trước khi chạy
    addLog('Đang kiểm tra License Token...', 'info')
    const storageRes = await chrome.storage.local.get(['fb-app-token', 'fb-device-id'])
    const appToken = storageRes['fb-app-token']
    const deviceId = storageRes['fb-device-id']

    if (!appToken) {
      addLog('Lỗi: Bạn chưa thiết lập License Token. Vui lòng sang tab Cài đặt.', 'error')
      setRunning(false)
      return
    }

      // Gọi background script để validate token 
      const validateRes = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'VALIDATE_LICENSE', token: appToken, deviceId },
          (res) => resolve(res)
        )
      })

      if (!validateRes || !validateRes.success || !validateRes.data?.valid) {
        addLog('Lỗi: License Token không hợp lệ, đã hết hạn hoặc hết lượt.', 'error')
        setRunning(false)
        return
      }

      if (validateRes.data.usageLimit <= 0) {
        addLog('Lỗi: License Token của bạn đã hết lượt dọn dẹp (usageLimit = 0).', 'error')
        setRunning(false)
        return
      }

      addLog(`Token xác thực thành công. Lượt còn lại: ${validateRes.data.usageLimit}`, 'success')
      
      const config: CleanerConfig = {
        keywords: keywords.trim(),
        maxPosts,
        fromDate,
      }

      addLog(`Đang bắt đầu dọn dẹp ${MODE_META[mode].label}...`, 'info')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id) {
        addLog('Lỗi: Không tìm thấy tab đang hoạt động.', 'error')
        setRunning(false)
        return
      }
      if (!tab.url?.includes('facebook.com')) {
        addLog('Lỗi: Vui lòng điều hướng đến trang nhóm Facebook trước.', 'error')
        setRunning(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Lỗi: Không thể tải mã xử lý. Hãy thử tải lại trang Facebook.', 'error')
        setRunning(false)
        return
      }

      const messageType =
        mode === 'feed'    ? 'START_POST_CLEANER' :
        mode === 'pending' ? 'START_PENDING_CLEANER' :
                             'START_SPAM_CLEANER'

      chrome.tabs.sendMessage(tab.id, {
        type: messageType,
        config,
        token: token.trim(),
        groupId: groupId.trim(),
      }, () => {
        if (chrome.runtime.lastError) {
          addLog('Lỗi: ' + chrome.runtime.lastError.message, 'error')
          setRunning(false)
        }
      })
    } catch (err) {
      addLog(`Lỗi: ${err}`, 'error')
      setRunning(false)
    }
  }

  const handleStop = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_POST_CLEANER' })
      }
    })
    setRunning(false)
    addLog('Đã dừng bởi người dùng.', 'warning')
  }

  const handleClearLogs = () => {
    setLogs([])
    logIdRef.current = 0
  }

  return (
    <div className="tool-panel">
      {/* Mode Selector */}
      <div className="mode-selector">
        {(Object.keys(MODE_META) as Mode[]).map((m) => (
          <button
            key={m}
            className={`mode-btn ${mode === m ? 'mode-active' : ''} mode-${m}`}
            onClick={() => handleModeChange(m)}
            disabled={running}
            title={MODE_META[m].desc}
          >
            {MODE_META[m].emoji} {MODE_META[m].label}
          </button>
        ))}
      </div>

      {/* Settings Card */}
      <div className="control-card">
        {/* Token — only for feed mode */}
        {mode === 'feed' && (
          <div className="form-group">
            <label htmlFor="accessToken">Mã truy cập (Access Token)</label>
            <input
              id="accessToken"
              type="password"
              placeholder="Dán mã token Facebook Graph API của bạn..."
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              disabled={running}
              className="form-input"
            />
            <span className="form-hint">Không bắt buộc. Nếu để trống, sẽ sử dụng GraphQL dựa trên cookie (không cần token).</span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="groupId">ID Nhóm</label>
          <div className="input-with-btn">
            <input
              id="groupId"
              type="text"
              placeholder="ví dụ: 1441796987660953"
              value={groupId}
              onChange={(e) => handleGroupIdChange(e.target.value)}
              disabled={running}
              className="form-input"
            />
            <button
              className="detect-btn"
              onClick={detectGroupId}
              disabled={running || groupIdLoading}
              title="Tự động phát hiện từ trang hiện tại"
            >
              {groupIdLoading ? '⏳' : '🔍'}
            </button>
          </div>
          <span className="form-hint">Nhấn 🔍 để tự động phát hiện từ trang nhóm Facebook hiện tại.</span>
        </div>
      </div>

      {/* Filter Settings */}
      <div className="control-card">
        <div className="form-group">
          <label htmlFor="keywords">Từ khóa</label>
          <input
            id="keywords"
            type="text"
            placeholder="rác, bán hàng, quảng cáo..."
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            disabled={running}
            className="form-input"
          />
          <span className="form-hint">Cách nhau bằng dấu phẩy. Bài viết khớp với BẤT KỲ từ khóa nào sẽ bị xóa.</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="maxPosts">Số bài tối đa</label>
            <input
              id="maxPosts"
              type="number"
              min={1}
              max={10000}
              value={maxPosts}
              onChange={(e) => setMaxPosts(Math.min(10000, Math.max(1, Number(e.target.value))))}
              disabled={running}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="fromDate">Từ ngày</label>
            <input
              id="fromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={running}
              className="form-input"
            />
          </div>
        </div>

        <div className="actions">
          {!running ? (
            <button
              className="start-btn"
              onClick={handleStart}
            >
              ▶ Bắt đầu dọn dẹp {MODE_META[mode].label}
            </button>
          ) : (
            <button className="stop-btn" onClick={handleStop}>
              ■ Dừng
            </button>
          )}
        </div>
      </div>

      {/* Progress Log */}
      <div className="log-card">
        <div className="log-header">
          <span className="log-title">Nhật ký tiến trình</span>
          <button className="log-clear" onClick={handleClearLogs} disabled={running}>
            Xóa nhật ký
          </button>
        </div>
        <div className="log-body" ref={logRef}>
          {logs.length === 0 ? (
            <p className="log-empty">Chưa có hoạt động nào. Chọn một chế độ và nhấn Bắt đầu.</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className={`log-entry log-${entry.type}`}>
                {entry.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
