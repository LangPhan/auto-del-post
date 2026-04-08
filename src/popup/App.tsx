import { Activity, useState } from 'react'
import './App.css'
import FontSizeTool from './components/FontSizeTool'
import PostCleanerTool from './components/PostCleanerTool'

type Tab = 'font-size' | 'post-cleaner'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('post-cleaner')

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="header-icon">🔧</div>
        <div>
          <h1>Facebook Tools</h1>
          <p className="subtitle">Extension Toolkit</p>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'font-size' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('font-size')}
        >
          Aa Font Size
        </button>
        <button
          className={`tab ${activeTab === 'post-cleaner' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('post-cleaner')}
        >
          🧹 Post Cleaner
        </button>
      </nav>

      <Activity mode={activeTab === "font-size" ? "visible" : "hidden"}>
        <FontSizeTool/>
      </Activity>
      <Activity mode={activeTab === "post-cleaner" ? "visible" : "hidden"}>
        <PostCleanerTool/>
      </Activity>

      <footer className="popup-footer">
        {activeTab === 'font-size'
          ? 'Adjust the font size of your Facebook news feed'
          : 'Select a mode, set filters, then click Start Cleaner'}
      </footer>
    </div>
  )
}
