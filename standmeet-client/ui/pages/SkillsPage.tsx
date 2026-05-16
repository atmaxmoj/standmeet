import { useState } from "react";
import MySkillsTab from "./MySkillsTab";
import MarketplaceTab from "./MarketplaceTab";

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<"my" | "marketplace">("my");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border, #ddd)", padding: "0 16px" }}>
        <button
          data-testid="skills-tab-my"
          className={`small ${activeTab === "my" ? "primary" : ""}`}
          onClick={() => setActiveTab("my")}
          style={{ borderRadius: "4px 4px 0 0", borderBottom: activeTab === "my" ? "2px solid var(--accent, #2196f3)" : "2px solid transparent" }}
        >
          My Skills
        </button>
        <button
          data-testid="skills-tab-marketplace"
          className={`small ${activeTab === "marketplace" ? "primary" : ""}`}
          onClick={() => setActiveTab("marketplace")}
          style={{ borderRadius: "4px 4px 0 0", borderBottom: activeTab === "marketplace" ? "2px solid var(--accent, #2196f3)" : "2px solid transparent" }}
        >
          Marketplace
        </button>
      </div>
      {activeTab === "my" ? <MySkillsTab /> : <MarketplaceTab />}
    </div>
  );
}
