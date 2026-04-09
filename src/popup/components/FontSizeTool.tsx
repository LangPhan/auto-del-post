import { deletePost, likePost } from '@/utils/query'
import { useEffect, useState } from 'react'

const MIN = 50
const MAX = 200
const STEP = 5
const DEFAULT = 100
const STORAGE_KEY = 'fb-feed-font-size'

export default function FontSizeTool() {
  const [fontSize, setFontSize] = useState(DEFAULT)
  const [applied, setApplied] = useState(false)
  const [liking, setLiking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState<{ text: string; type: 'success' | 'error' | '' }>({ text: '', type: '' })

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((result) => {
      const saved = result[STORAGE_KEY] as number | undefined
      if (saved) {
        setFontSize(saved)
      }
    })
  }, [])


  const applyFontSize = (size: number) => {
    setFontSize(size)
    setApplied(false)
    chrome.storage.local.set({ [STORAGE_KEY]: size })
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_FONT_SIZE', size }, () => {
          if (!chrome.runtime.lastError) {
            setApplied(true)
            setTimeout(() => setApplied(false), 1500)
          }
        })
      }
    })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyFontSize(Number(e.target.value))
  }

  const handleReset = () => {
    applyFontSize(DEFAULT)
  }

  const handleLike = async () => {
    setLiking(true)
    setStatus({ text: '', type: '' })
    try {
      const result = await likePost()
      setStatus({ 
        text: result.message, 
        type: result.success ? 'success' : 'error' 
      })
      if (result.success) {
        setTimeout(() => setStatus({ text: '', type: '' }), 3000)
      }
    } catch (err) {
      setStatus({ text: `Lỗi kết nối: ${err}`, type: 'error' })
    } finally {
      setLiking(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setStatus({ text: '', type: '' })
    try {
      const result = await deletePost('754667900821399_933145626306958')
      setStatus({ 
        text: result.message, 
        type: result.success ? 'success' : 'error' 
      })
      if (result.success) {
        setTimeout(() => setStatus({ text: '', type: '' }), 3000)
      }
    } catch (err) {
      setStatus({ text: `Lỗi kết nối: ${err}`, type: 'error' })
    } finally {
      setDeleting(false)
    }
  }

  const progress = ((fontSize - MIN) / (MAX - MIN)) * 100

  return (
    <div className="tool-panel">
      <div className="control-card">
        <div className="size-display">
          <span className="size-value">{fontSize}</span>
          <span className="size-unit">%</span>
        </div>

        <div className="actions" style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button 
            className="start-btn" 
            onClick={handleLike} 
            disabled={liking || deleting}
          >
            {liking ? '⌛ Đang thích...' : '👍 Thử thích bài viết'}
          </button>
          <button 
            className="stop-btn" 
            onClick={handleDelete} 
            disabled={liking || deleting}
            style={{ width: '100%', padding: '9px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            {deleting ? '⌛ Đang xóa...' : '🗑️ Thử xóa bài viết'}
          </button>
          {status.text && (
            <div style={{ 
              marginTop: '0.5rem', 
              fontSize: '0.8rem', 
              color: status.type === 'success' ? '#4caf50' : '#f44336' 
            }}>
              {status.text}
            </div>
          )}
        </div>

        <div className="slider-container">
          <input
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={fontSize}
            onChange={handleChange}
            className="slider"
            style={{ '--progress': `${progress}%` } as React.CSSProperties}
          />
          <div className="slider-labels">
            <span>{MIN}%</span>
            <span>{MAX}%</span>
          </div>
        </div>

        <div className="actions">
          <button
            className="reset-btn"
            onClick={handleReset}
            disabled={fontSize === DEFAULT}
          >
            ↺ Đặt lại về 100%
          </button>
          {applied && <span className="applied-badge">✓ Đã áp dụng</span>}
        </div>
      </div>
    </div>
  )
}
