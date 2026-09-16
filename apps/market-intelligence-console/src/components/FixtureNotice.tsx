// OPS-TELEMETRY-001: 占位数据横幅。
//
// 为什么需要它：/v1/operator/decision-engine 返回 evaluate_calls_30d "18.6M"、
// lineage_complete "99.92%" 这类数字，它们**长得和遥测一模一样**，但服务端
// 一个查询都没做。运营看到"30 天 1860 万次调用 · 谱系完整度 99.92%"会认为
// 引擎在跑 —— 一个假的健康度比没有健康度更糟，因为它让人停止怀疑。
//
// 横幅的显示条件是**服务端响应里的 dataSource 字段**，不是前端硬编码的页面列表。
// 这样"这个数字有没有来源"只有一个真源：谁产生数据，谁声明来源。前端不再需要
// 维护一份"哪些页面是假的"的清单（那种清单一定会和现实脱节）。
//
// 注意：不是所有 /v1/operator/* 都是占位。例如 context-field / surface-plans
// 真的调用了 runtime.Decide 和 compiler.Compile，只是输入是固定快照。
// 所以这里不能写"整个控制台都是假数据"—— 那会是另一个谎。
// 只对声明了 dataSource 的响应显示。
export function FixtureNotice({ dataSource }: { dataSource?: string | undefined }) {
  if (dataSource !== "FIXTURE") return null;
  return (
    <div
      role="status"
      style={{
        alignItems: "center",
        background: "#FFF4E0",
        border: "1px solid #E8B84B",
        borderRadius: 8,
        color: "#6B4A05",
        display: "flex",
        fontSize: 12,
        gap: 8,
        lineHeight: 1.5,
        marginBottom: 12,
        padding: "8px 12px",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>
        <b>占位数据</b>：本页数字由服务端写死，没有任何数据源（未查表、未接遥测）。
        请勿据此判断系统健康度或业务规模。
      </span>
    </div>
  );
}
