import type { DemandConfirmation, TaskDraftChanges } from "@proxy/contracts";

export type RequesterScenario = "STORE_OPENING" | "EVENT_SUPPORT" | "ADMIN_SUPPORT";

export type NeedForm = {
  sourceInput: string;
  scenario: RequesterScenario;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  quantity: string;
  budget: string;
};

export type NeedFormErrors = Partial<Record<keyof NeedForm | "timeRange", string | undefined>>;

const scenarioConfig: Record<RequesterScenario, { industry: string; label: string; roleId: string; deliverable: string }> = {
  STORE_OPENING: { industry: "retail", label: "门店开业接待", roleId: "GREETER", deliverable: "guest_reception_summary" },
  EVENT_SUPPORT: { industry: "events", label: "活动现场支持", roleId: "EVENT_ASSISTANT", deliverable: "event_completion_summary" },
  ADMIN_SUPPORT: { industry: "business_services", label: "临时行政协助", roleId: "ADMIN_ASSISTANT", deliverable: "work_completion_summary" }
};

export function createInitialNeedForm(now: Date = new Date(), scenario: RequesterScenario = "EVENT_SUPPORT"): NeedForm {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    sourceInput: "",
    scenario,
    location: "",
    date: localDate(tomorrow),
    startTime: "09:00",
    endTime: "12:00",
    quantity: "1",
    budget: "80"
  };
}

export function scenarioLabel(scenario: RequesterScenario): string {
  return scenarioConfig[scenario].label;
}

export function validateNeedForm(form: NeedForm): NeedFormErrors {
  const errors: NeedFormErrors = {};
  if (form.sourceInput.trim().length < 8) errors.sourceInput = "请再具体一点，至少描述希望发生的结果。";
  if (form.location.trim().length < 2) errors.location = "请填写执行地点。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = "日期格式应为 YYYY-MM-DD。";
  if (!/^\d{2}:\d{2}$/.test(form.startTime)) errors.startTime = "时间格式应为 HH:mm。";
  if (!/^\d{2}:\d{2}$/.test(form.endTime)) errors.endTime = "时间格式应为 HH:mm。";
  const quantity = Number(form.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) errors.quantity = "人数应为 1–20。";
  const budget = Number(form.budget);
  if (!Number.isFinite(budget) || budget <= 0) errors.budget = "请输入有效预算。";

  if (!errors.date && !errors.startTime && !errors.endTime) {
    const start = parseLocalDateTime(form.date, form.startTime);
    const end = parseLocalDateTime(form.date, form.endTime);
    if (!start || !end || end.getTime() <= start.getTime()) errors.timeRange = "结束时间必须晚于开始时间。";
  }
  return errors;
}

export function buildTaskDraftChanges(form: NeedForm, confirmation?: DemandConfirmation): TaskDraftChanges {
  const errors = validateNeedForm(form);
  if (Object.keys(errors).length > 0) throw new Error("need form is incomplete");
  const config = scenarioConfig[form.scenario];
  const start = parseLocalDateTime(form.date, form.startTime)!;
  const end = parseLocalDateTime(form.date, form.endTime)!;
  return {
    industry: config.industry,
    scenario: form.scenario,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    location: { mode: "PLACE_ONLY", label: form.location.trim() },
    slotGroups: [{ roleId: config.roleId, quantity: Number(form.quantity), mustCapabilities: [] }],
    mustRequirements: ["arrive_on_time", "professional_service"],
    preferences: [],
    deliverables: [config.deliverable],
    budget: { currency: "USD", amountMinor: Math.round(Number(form.budget) * 100), pricingMode: "PER_SLOT_FIXED" },
    matchingMode: "CURATED",
    catalogVersion: "CATALOG_V1",
    policySnapshot: { policySetId: "PSET_LAUNCH", policySetVersion: "1" },
    draftProgress: confirmation ? 100 : 72,
    lastCompletedStep: confirmation ? 11 : 8,
    ...(confirmation ? { confirmation } : {})
  };
}

export function describeNeed(form: NeedForm): string {
  return `${scenarioLabel(form.scenario)} · ${form.quantity} 人 · ${form.date} ${form.startTime}–${form.endTime}`;
}

function parseLocalDateTime(date: string, time: string): Date | undefined {
  const value = new Date(`${date}T${time}:00`);
  return Number.isFinite(value.getTime()) ? value : undefined;
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
