import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";
import { FixtureNotice } from "../components/FixtureNotice";

type Payload = { dataSource?: string; gates: Array<{ state: string; desc: string; example: string; allow: boolean }>; question_preview: { qtext: string; choices: string[]; reason: string } };

export function Clarification() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/clarification-gate").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Clarification Gate…</div>;
  return (
    <>
      <FixtureNotice dataSource={data.dataSource} />
      <div className="section-title"><h2>Clarification Gate</h2><span>PASS / CLARIFY / BLOCK · 允许/追问/阻断</span></div>
      <div className="clarify-matrix">
        {data.gates.map((g) => (
          <div key={g.state} className={`cq ${g.allow ? "allow" : g.state === "BLOCK" ? "block" : "warn"}`}>
            <div className="state">{g.state}</div><div className="desc">{g.desc}<br />例：{g.example}</div>
          </div>
        ))}
      </div>
      <div className="section-title"><h2>Question Preview</h2><span>追问不直接创单，仅补齐决策所需字段</span></div>
      <div className="question-preview">
        <div className="eyebrow">CRITICAL QUESTION</div><div className="qtext">{data.question_preview.qtext}</div>
        <div className="choices">{data.question_preview.choices.map((c) => <span key={c} className="choice">{c}</span>)}</div>
        <div className="meta">{data.question_preview.reason}</div>
      </div>
    </>
  );
}
