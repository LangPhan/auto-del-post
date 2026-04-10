import {
  Activity,
  useState,
} from "react";
import "./App.css";
import PostCleanerTool from "./components/PostCleanerTool";

type Tab = "font-size" | "post-cleaner";

export default function App() {
  const [activeTab, setActiveTab] =
    useState<Tab>("post-cleaner");

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="header-icon">
          🔧
        </div>
        <div>
          <h1>Công cụ Facebook</h1>
          <p className="subtitle">
            Bộ công cụ tiện ích
          </p>
        </div>
      </header>

      <nav className="tabs">
        {/* <button
          className={`tab ${activeTab === "font-size" ? "tab-active" : ""}`}
          onClick={() =>
            setActiveTab("font-size")
          }
        >
          Aa Cỡ chữ
        </button> */}
        <button
          className={`tab ${activeTab === "post-cleaner" ? "tab-active" : ""}`}
          onClick={() =>
            setActiveTab("post-cleaner")
          }
        >
          🧹 Dọn dẹp bài viết
        </button>
      </nav>

      {/* <Activity mode={activeTab === "font-size" ? "visible" : "hidden"}>
        <FontSizeTool/>
      </Activity> */}
      <Activity
        mode={
          activeTab === "post-cleaner"
            ? "visible"
            : "hidden"
        }
      >
        <PostCleanerTool />
      </Activity>

      <footer className="popup-footer">
        {activeTab === "font-size"
          ? "Điều chỉnh kích cỡ chữ trên bảng tin Facebook của bạn"
          : "Chọn chế độ, thiết lập bộ lọc, sau đó nhấn Bắt đầu dọn dẹp"}
      </footer>
    </div>
  );
}
