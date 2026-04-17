import { ensureContentScript } from '@/utils/query'
import { useCallback, useEffect, useRef, useState } from 'react'

const PAGE_ID_STORAGE_KEY = 'fb-page-id'

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

export default function PageManageTool() {
  const [keywords, setKeywords] = useState('')
  const [maxPosts, setMaxPosts] = useState(5)
  const [fromDate, setFromDate] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pageId, setPageId] = useState('')
  const [pageIdLoading, setPageIdLoading] = useState(false)
  const [usageLimit, setUsageLimit] = useState<number | null>(null)
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

  // Load pageId and usageLimit from storage on mount
  useEffect(() => {
    chrome.storage.local.get([PAGE_ID_STORAGE_KEY, 'fb-usage-limit']).then((result) => {
      if (result[PAGE_ID_STORAGE_KEY]) setPageId(result[PAGE_ID_STORAGE_KEY] as string)
      if (result['fb-usage-limit'] !== undefined) setUsageLimit(result['fb-usage-limit'] as number)
    })

    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['fb-usage-limit']) {
        setUsageLimit(changes['fb-usage-limit'].newValue as number | null)
      }
    }
    chrome.storage.onChanged.addListener(storageListener)
    return () => chrome.storage.onChanged.removeListener(storageListener)
  }, [])

  const handlePageIdChange = (value: string) => {
    setPageId(value)
    chrome.storage.local.set({ [PAGE_ID_STORAGE_KEY]: value })
  }

  // Auto-detect pageId from current page
  const detectPageId = useCallback(async () => {
    setPageIdLoading(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        addLog('Lỗi: Không tìm thấy tab đang hoạt động.', 'error')
        setPageIdLoading(false)
        return
      }
      if (!tab.url?.includes('facebook.com')) {
        addLog('Lỗi: Vui lòng điều hướng đến trang Facebook trước.', 'error')
        setPageIdLoading(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Lỗi: Không thể tải mã xử lý (content script).', 'error')
        setPageIdLoading(false)
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_ID' }, (response) => {
        setPageIdLoading(false)
        if (chrome.runtime.lastError) {
          addLog('Lỗi khi phát hiện ID Page: ' + chrome.runtime.lastError.message, 'error')
          return
        }
        if (response?.pageId) {
          setPageId(response.pageId)
          chrome.storage.local.set({ [PAGE_ID_STORAGE_KEY]: response.pageId })
          addLog(`Đã phát hiện ID Page: ${response.pageId}`, 'success')
        } else {
          addLog('Không thể phát hiện ID Page từ trang này.', 'warning')
        }
      })
    } catch (err) {
      addLog(`Lỗi khi phát hiện ID Page: ${err}`, 'error')
      setPageIdLoading(false)
    }
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const handleStart = async () => {
    if (running) return

    if (!pageId.trim()) {
      addLog('Lỗi: Vui lòng nhập hoặc tự động phát hiện ID Page trước.', 'error')
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

    addLog('Đang bắt đầu dọn dẹp bài viết Page...', 'info')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id) {
        addLog('Lỗi: Không tìm thấy tab đang hoạt động.', 'error')
        setRunning(false)
        return
      }
      if (!tab.url?.includes('facebook.com')) {
        addLog('Lỗi: Vui lòng điều hướng đến trang Facebook Page trước.', 'error')
        setRunning(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Lỗi: Không thể tải mã xử lý. Hãy thử tải lại trang Facebook.', 'error')
        setRunning(false)
        return
      }

      chrome.tabs.sendMessage(tab.id, {
        type: 'START_PAGE_CLEANER',
        config,
        pageId: pageId.trim(),
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
      {/* Settings Card */}
      <div className="control-card">
        <div className="form-group">
          <label htmlFor="pageId">ID Page</label>
          <div className="input-with-btn">
            <input
              id="pageId"
              type="text"
              placeholder="ví dụ: 61567645610078"
              value={pageId}
              onChange={(e) => handlePageIdChange(e.target.value)}
              disabled={running}
              className="form-input"
            />
            <button
              className="detect-btn"
              onClick={detectPageId}
              disabled={running || pageIdLoading}
              title="Tự động phát hiện từ trang hiện tại"
            >
              {pageIdLoading ? '⏳' : '🔍'}
            </button>
          </div>
          <span className="form-hint">Nhấn 🔍 để tự động phát hiện từ trang Facebook Page hiện tại.</span>
        </div>
      </div>

      {/* Filter Settings */}
      <div className="control-card">
        <div className="form-group">
          <label htmlFor="pageKeywords">Từ khóa</label>
          <input
            id="pageKeywords"
            type="text"
            placeholder="rác, bán hàng, quảng cáo..."
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            disabled={running}
            className="form-input"
          />
          <span className="form-hint">Cách nhau bằng dấu phẩy. Bài viết khớp với BẤT KỲ từ khóa nào sẽ bị xóa. Để trống = xóa tất cả.</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pageMaxPosts">
              Số bài tối đa {usageLimit !== null && <span className="limit-badge" style={{color: 'green', fontSize: '0.85em', marginLeft: 4}}>(Limit: {usageLimit})</span>}
            </label>
            <input
              id="pageMaxPosts"
              type="number"
              min={1}
              max={usageLimit !== null ? usageLimit : 10000}
              value={maxPosts}
              onChange={(e) => {
                let limitVal = usageLimit !== null ? usageLimit : 10000
                setMaxPosts(Math.min(limitVal, Math.max(1, Number(e.target.value))))
              }}
              disabled={running}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="pageFromDate">Từ ngày</label>
            <input
              id="pageFromDate"
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
              ▶ Bắt đầu dọn dẹp Page
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
            <p className="log-empty">Chưa có hoạt động nào. Nhập ID Page và nhấn Bắt đầu.</p>
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
