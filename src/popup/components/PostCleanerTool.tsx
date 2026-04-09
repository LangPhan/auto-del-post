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
  feed:    { emoji: '📰', label: 'Feed',    desc: 'Delete matching posts from your group feed' },
  pending: { emoji: '⏳', label: 'Pending', desc: 'Delete matching posts from the pending queue' },
  spam:    { emoji: '🚫', label: 'Spam',    desc: 'Delete matching posts from the spam / modmin review folder' },
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
        addLog(message.text ?? 'Process completed.', 'success')
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
        addLog('Error: No active tab found.', 'error')
        setGroupIdLoading(false)
        return
      }
      if (!tab.url?.includes('facebook.com')) {
        addLog('Error: Please navigate to a Facebook page first.', 'error')
        setGroupIdLoading(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Error: Could not load content script.', 'error')
        setGroupIdLoading(false)
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: 'GET_GROUP_ID' }, (response) => {
        setGroupIdLoading(false)
        if (chrome.runtime.lastError) {
          addLog('Error detecting groupId: ' + chrome.runtime.lastError.message, 'error')
          return
        }
        if (response?.groupId) {
          setGroupId(response.groupId)
          chrome.storage.local.set({ [GROUP_ID_STORAGE_KEY]: response.groupId })
          addLog(`Detected groupId: ${response.groupId}`, 'success')
        } else {
          addLog('Could not detect groupId from this page.', 'warning')
        }
      })
    } catch (err) {
      addLog(`Error detecting groupId: ${err}`, 'error')
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
      addLog('Error: Please enter or detect Group ID first.', 'error')
      return
    }

    const config: CleanerConfig = {
      keywords: keywords.trim(),
      maxPosts,
      fromDate,
    }

    setRunning(true)
    setLogs([])
    addLog(`Starting ${MODE_META[mode].label} cleaner...`, 'info')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id) {
        addLog('Error: No active tab found.', 'error')
        setRunning(false)
        return
      }

      if (!tab.url?.includes('facebook.com')) {
        addLog('Error: Please navigate to a Facebook group page first.', 'error')
        setRunning(false)
        return
      }

      const ready = await ensureContentScript(tab.id)
      if (!ready) {
        addLog('Error: Could not load content script. Try refreshing the Facebook page.', 'error')
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
          addLog('Error: ' + chrome.runtime.lastError.message, 'error')
          setRunning(false)
        }
      })
    } catch (err) {
      addLog(`Error: ${err}`, 'error')
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
    addLog('Stopped by user.', 'warning')
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
            <label htmlFor="accessToken">Access Token</label>
            <input
              id="accessToken"
              type="password"
              placeholder="Paste your Facebook Graph API token..."
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              disabled={running}
              className="form-input"
            />
            <span className="form-hint">Optional. If empty, uses cookie-based GraphQL (no token needed).</span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="groupId">Group ID</label>
          <div className="input-with-btn">
            <input
              id="groupId"
              type="text"
              placeholder="e.g. 1441796987660953"
              value={groupId}
              onChange={(e) => handleGroupIdChange(e.target.value)}
              disabled={running}
              className="form-input"
            />
            <button
              className="detect-btn"
              onClick={detectGroupId}
              disabled={running || groupIdLoading}
              title="Auto-detect from current page"
            >
              {groupIdLoading ? '⏳' : '🔍'}
            </button>
          </div>
          <span className="form-hint">Click 🔍 to auto-detect from the current Facebook group page.</span>
        </div>
      </div>

      {/* Filter Settings */}
      <div className="control-card">
        <div className="form-group">
          <label htmlFor="keywords">Keywords</label>
          <input
            id="keywords"
            type="text"
            placeholder="spam, sell, promotion..."
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            disabled={running}
            className="form-input"
          />
          <span className="form-hint">Comma-separated. Posts matching ANY keyword will be deleted.</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="maxPosts">Max posts</label>
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
            <label htmlFor="fromDate">From date</label>
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
              ▶ Start {MODE_META[mode].label} Cleaner
            </button>
          ) : (
            <button className="stop-btn" onClick={handleStop}>
              ■ Stop
            </button>
          )}
        </div>
      </div>

      {/* Progress Log */}
      <div className="log-card">
        <div className="log-header">
          <span className="log-title">Progress Log</span>
          <button className="log-clear" onClick={handleClearLogs} disabled={running}>
            Clear
          </button>
        </div>
        <div className="log-body" ref={logRef}>
          {logs.length === 0 ? (
            <p className="log-empty">No activity yet. Select a mode and click Start.</p>
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
