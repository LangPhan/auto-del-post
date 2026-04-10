import {
  Activity,
  useState,
} from "react";
import "./App.css";
import PostCleanerTool from "./components/PostCleanerTool";

type Tab = "post-cleaner";

export default function App() {
  const [activeTab, setActiveTab] =
    useState<Tab>("post-cleaner");

  return (
    <div className="sidepanel">
      <header className="sp-header">
        <div className="sp-header-icon">
          🔧
        </div>
        <div className="sp-header-info">
          <h1>Công cụ Facebook</h1>
          <p>Bộ công cụ tiện ích quản lý nhóm</p>
        </div>
      </header>

      <nav className="sp-tabs">
        <button
          className={`sp-tab ${activeTab === "post-cleaner" ? "sp-tab-active" : ""}`}
          onClick={() =>
            setActiveTab("post-cleaner")
          }
        >
          🧹 Dọn dẹp bài viết
        </button>
      </nav>

      <div className="sp-content">
        <Activity
          mode={
            activeTab === "post-cleaner"
              ? "visible"
              : "hidden"
          }
        >
          <PostCleanerTool />
        </Activity>
      </div>

      <footer className="sp-footer">
        Chọn chế độ, thiết lập bộ lọc, sau đó nhấn Bắt đầu dọn dẹp
      </footer>
    </div>
  );
}
