import { Suspense, lazy, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BadgeDollarSign, BarChart3, Bell, Boxes, BriefcaseBusiness,
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CreditCard,
  FileText, LayoutDashboard, LogOut, Menu, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Users, X, Zap,
} from "lucide-react";
import { api, ApiError, type Dashboard, type ModelPredictionResult, type ModelTrainingResult, type Row, type User } from "./api";
import "./App.css";

const RevenueChart = lazy(() => import("./RevenueChart"));

type PageKey = "overview" | "customers" | "products" | "plans" | "subscriptions" | "invoices" | "payments" | "reports" | "model-training";
type Notice = { kind: "success" | "error"; text: string } | null;
type Field = { key: string; label: string; type?: string; required?: boolean; options?: { label: string; value: string }[]; hint?: string };
type ResourceConfig = {
  title: string; singular: string; endpoint: string; icon: typeof Users;
  columns: { key: string; label: string; format?: "money" | "date" | "status" | "person" }[];
  fields: Field[]; permission?: "admin" | "staff"; searchable?: string[];
};

const resourceConfig: Partial<Record<PageKey, ResourceConfig>> = {
  customers: {
    title: "Customers", singular: "customer", endpoint: "/customers", icon: Users,
    columns: [
      { key: "name", label: "Customer", format: "person" }, { key: "company", label: "Company" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "created_at", label: "Added", format: "date" },
    ],
    fields: [
      { key: "name", label: "Full name", required: true }, { key: "email", label: "Email address", type: "email", required: true },
      { key: "company", label: "Company" }, { key: "phone", label: "Phone" },
    ], permission: "staff", searchable: ["name", "email", "company"],
  },
  products: {
    title: "Products", singular: "product", endpoint: "/products?limit=100", icon: Boxes,
    columns: [
      { key: "name", label: "Product", format: "person" }, { key: "product_type", label: "Type" },
      { key: "variants", label: "Variants" }, { key: "active", label: "Status", format: "status" },
    ],
    fields: [
      { key: "name", label: "Product name", required: true }, { key: "product_type", label: "Product type", required: true, hint: "e.g. SaaS, software" },
      { key: "description", label: "Description", type: "textarea" }, { key: "variant_name", label: "First variant (optional)" },
      { key: "variant_price", label: "Variant price adjustment", type: "number", hint: "Additional amount for this variant" },
    ], permission: "admin", searchable: ["name", "product_type"],
  },
  plans: {
    title: "Plans", singular: "plan", endpoint: "/plans?limit=100", icon: FileText,
    columns: [
      { key: "name", label: "Plan", format: "person" }, { key: "product_id", label: "Product" },
      { key: "billing_frequency", label: "Billing cycle" }, { key: "price", label: "Price", format: "money" },
      { key: "active", label: "Status", format: "status" },
    ],
    fields: [
      { key: "name", label: "Plan name", required: true }, { key: "product_id", label: "Product", type: "select", required: true },
      { key: "price", label: "Price", type: "number", required: true }, {
        key: "billing_frequency", label: "Billing interval", type: "select", required: true,
        options: ["monthly", "yearly", "weekly", "daily"].map((item) => ({ label: item[0].toUpperCase() + item.slice(1), value: item })),
      },
      { key: "currency", label: "Currency", required: true, hint: "ISO 4217, e.g. USD" },
      { key: "minimum_quantity", label: "Minimum quantity", type: "number" },
      { key: "tax_rate", label: "Tax rate (%)", type: "number" },
    ], permission: "admin", searchable: ["name", "billing_frequency"],
  },
  subscriptions: {
    title: "Subscriptions", singular: "subscription", endpoint: "/subscriptions?limit=100", icon: Zap,
    columns: [
      { key: "number", label: "Subscription", format: "person" }, { key: "customer_id", label: "Customer" },
      { key: "plan_id", label: "Plan" }, { key: "unit_price", label: "Price", format: "money" },
      { key: "next_billing_date", label: "Next renewal", format: "date" }, { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { key: "customer_id", label: "Customer", type: "select", required: true },
      { key: "plan_id", label: "Plan", type: "select", required: true },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "auto_renew", label: "Auto-renew", type: "select", options: [{ label: "Enabled", value: "true" }, { label: "Disabled", value: "false" }] },
    ], searchable: ["number", "status"],
  },
  invoices: {
    title: "Invoices", singular: "invoice", endpoint: "/invoices?limit=100", icon: FileText,
    columns: [
      { key: "number", label: "Invoice", format: "person" }, { key: "customer_id", label: "Customer" },
      { key: "invoice_date", label: "Issued", format: "date" }, { key: "due_date", label: "Due date", format: "date" },
      { key: "total", label: "Amount", format: "money" }, { key: "outstanding_amount", label: "Outstanding", format: "money" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [], searchable: ["number", "status"],
  },
  payments: {
    title: "Payments", singular: "payment", endpoint: "/payments?limit=100", icon: CreditCard,
    columns: [
      { key: "reference", label: "Payment", format: "person" }, { key: "invoice_id", label: "Invoice" },
      { key: "method", label: "Method" }, { key: "paid_at", label: "Date", format: "date" },
      { key: "amount", label: "Amount", format: "money" },
    ],
    fields: [
      { key: "invoice_id", label: "Invoice", type: "select", required: true },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "method", label: "Method", type: "select", required: true, options: ["bank_transfer", "card", "cash", "upi", "other"].map((value) => ({ label: value.replace("_", " "), value })) },
      { key: "transaction_reference", label: "Transaction reference" }, { key: "notes", label: "Notes", type: "textarea" },
    ], searchable: ["reference", "method"],
  },
};

const navItems: { key: PageKey; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { key: "customers", label: "Customers", icon: Users, group: "Manage" },
  { key: "products", label: "Products", icon: Boxes, group: "Manage" },
  { key: "plans", label: "Plans", icon: FileText, group: "Manage" },
  { key: "subscriptions", label: "Subscriptions", icon: Zap, group: "Manage" },
  { key: "invoices", label: "Invoices", icon: FileText, group: "Finance" },
  { key: "payments", label: "Payments", icon: CreditCard, group: "Finance" },
  { key: "reports", label: "Reports", icon: BarChart3, group: "Finance" },
  { key: "model-training", label: "Model training", icon: Sparkles, group: "Finance" },
];

const money = (value: unknown, currency = "USD") => new Intl.NumberFormat(undefined, {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(Number(value ?? 0));
const dateLabel = (value: unknown) => value
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(String(value)))
  : "—";
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

function App() {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem("subscriptiq_user") ?? "null") as User | null; } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("subscriptiq_token"));
  const [page, setPage] = useState<PageKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [noticeId, setNoticeId] = useState(0);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const notify = useCallback((kind: "success" | "error", message: string) => {
    setNotice({ kind, text: message });
    setNoticeId((id) => id + 1);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice, noticeId]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api.get<{ status: string }>("/health", token)
      .then(() => { if (active) setApiOnline(true); })
      .catch(() => { if (active) setApiOnline(false); });
    return () => { active = false; };
  }, [token]);

  const onAuthenticated = (nextToken: string, nextUser: User) => {
    localStorage.setItem("subscriptiq_token", nextToken);
    localStorage.setItem("subscriptiq_user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
    setPage(nextUser.role === "customer" ? "subscriptions" : "overview");
  };
  const signOut = () => {
    localStorage.removeItem("subscriptiq_token");
    localStorage.removeItem("subscriptiq_user");
    setToken(null);
    setUser(null);
  };

  if (!user || !token) return <AuthPage onAuthenticated={onAuthenticated} notify={notify} notice={notice} />;

  const visibleNav = navItems.filter((item) => {
    if (user.role === "customer") return ["subscriptions", "invoices", "payments"].includes(item.key);
    if (user.role === "staff") return item.key !== "products" && item.key !== "plans" && item.key !== "model-training";
    return true;
  });
  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={21} strokeWidth={2.6} /></div>
          <div><strong>subscript<span>iq</span></strong><small>BRIGHTLOOP SOFTWARE</small></div>
          <button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="workspace-picker">
          <div className="workspace-icon">B</div>
          <div className="workspace-copy"><strong>Brightloop</strong><small>Business workspace</small></div>
          <ChevronDown size={16} className="muted-icon" />
        </div>
        <nav className="side-nav">
          {["Workspace", "Manage", "Finance"].map((group) => (
            <section key={group} className="nav-group">
              <p className="nav-label">{group}</p>
              {visibleNav.filter((item) => item.group === group).map(({ key, label, icon: Icon }) => (
                <button key={key} className={`nav-link ${page === key ? "active" : ""}`} onClick={() => { setPage(key); setSidebarOpen(false); }}>
                  <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
                  {key === "invoices" && <span className="nav-dot" />}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><div><b>Need a hand?</b><span>Visit our help center</span></div><ChevronRight size={15} /></div>
          <button className="profile-row" onClick={signOut}>
            <div className="avatar">{user.full_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
            <div className="profile-copy"><strong>{user.full_name}</strong><small>{user.role}</small></div>
            <LogOut size={16} className="muted-icon" />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="breadcrumbs">Workspace <ChevronRight size={14} /> <strong>{pageTitle(page, user.role)}</strong></div></div>
          <div className="topbar-actions"><div className={`api-pill ${apiOnline === false ? "api-offline" : ""}`}><i /> {apiOnline === null ? "Connecting" : apiOnline ? "API connected" : "API unavailable"}</div><button className="icon-button notification-button" aria-label="View invoices" onClick={() => setPage("invoices")}><Bell size={19} /></button><div className="topbar-divider" /><div className="top-user"><div className="avatar avatar-small">{user.full_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><span>{user.full_name.split(" ")[0]}</span></div></div>
        </header>
        <div className="page-content">
          {page === "overview"
            ? <DashboardPage token={token} user={user} onNavigate={setPage} notify={notify} />
            : page === "model-training"
              ? <ModelTrainingPage token={token} notify={notify} />
            : page === "reports"
              ? <ReportsPage token={token} notify={notify} />
              : <ResourcePage key={page} page={page} token={token} user={user} notify={notify} />}
          <footer className="app-footer"><span>© 2026 Brightloop Software</span><span><ShieldCheck size={13} /> Secure billing workspace</span></footer>
        </div>
      </main>
      {notice && <div className={`toast toast-${notice.kind}`} key={noticeId}><span className="toast-icon">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}</span>{notice.text}</div>}
    </div>
  );
}

function pageTitle(page: PageKey, role: User["role"]) {
  if (role === "customer" && page === "subscriptions") return "Customer portal";
  return navItems.find((item) => item.key === page)?.label ?? "Overview";
}

function ModelTrainingPage({ token, notify }: { token: string; notify: (kind: "success" | "error", message: string) => void }) {
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<ModelTrainingResult | null>(null);
  const [total, setTotal] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<ModelPredictionResult | null>(null);

  const train = async () => {
    setTraining(true);
    try {
      const trained = await api.post<ModelTrainingResult>("/model/train", {}, token);
      setResult(trained);
      setPrediction(null);
      notify("success", `Model trained with ${trained.training_rows} invoice records`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Model training failed");
    } finally {
      setTraining(false);
    }
  };

  const runPrediction = async (event: FormEvent) => {
    event.preventDefault();
    setPredicting(true);
    try {
      const predicted = await api.post<ModelPredictionResult>("/model/predict", {
        total,
        due_date: dueDate,
      }, token);
      setPrediction(predicted);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  };

  return (
    <div className="resource-page model-training-page">
      <div className="page-heading resource-heading">
        <div>
          <div className="eyebrow light-eyebrow"><Sparkles size={14} /> EXPERIMENTAL ANALYTICS</div>
          <h1>Invoice model training<span className="heading-period">.</span></h1>
          <p>Train a demo classifier on the included invoice dataset and inspect its training summary.</p>
        </div>
        <button className="button button-primary" onClick={() => void train()} disabled={training}>
          <Sparkles size={15} /> {training ? "Training model..." : result ? "Train again" : "Train model"}
        </button>
      </div>

      <section className="model-warning panel">
        <div className="stat-icon orange"><ShieldCheck size={18} /></div>
        <div><strong>Demonstration only</strong><p>Only four invoices are included. This is not enough to validate reliable predictions and should not be used for billing decisions.</p></div>
      </section>

      <section className="panel model-predict-panel">
        <div className="panel-heading"><div><h2>Try a prediction</h2><p>Enter invoice details to get the trained model’s illustrative status estimate.</p></div></div>
        <form className="model-predict-form" onSubmit={(event) => void runPrediction(event)}>
          <label>Invoice total (INR)<input type="number" min="0" step="0.01" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="e.g. 1499.00" required /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
          <button className="button button-primary" type="submit" disabled={!result || predicting || !total}>
            <Sparkles size={15} />{predicting ? "Predicting..." : "Predict status"}
          </button>
        </form>
        {!result && <p className="model-predict-hint">Train the model first to enable predictions.</p>}
        {prediction && (
          <div className="model-prediction-result" aria-live="polite">
            <div className="model-prediction-main">
              <span>Estimated status</span>
              <strong className={`status-badge status-${prediction.predicted_status}`}><i />{prediction.predicted_status.replace("_", " ")}</strong>
            </div>
            <div className="model-probabilities">
              {Object.entries(prediction.probabilities).map(([label, probability]) => (
                <div key={label}><span>{label.replace("_", " ")}</span><strong>{Math.round(probability * 100)}%</strong></div>
              ))}
            </div>
            <p className="model-note">{prediction.note}</p>
          </div>
        )}
      </section>

      {result ? (
        <>
          <div className="stats-grid model-stats">
            <div className="stat-card"><div className="stat-top"><span>Training records</span><div className="stat-icon purple"><FileText size={17} /></div></div><strong>{result.training_rows}</strong><div className="stat-note">Invoice labels used for training</div></div>
            <div className="stat-card"><div className="stat-top"><span>Algorithm</span><div className="stat-icon blue"><Sparkles size={17} /></div></div><strong className="stat-value-small">Naive Bayes</strong><div className="stat-note">Categorical classifier</div></div>
            <div className="stat-card"><div className="stat-top"><span>Model target</span><div className="stat-icon green"><Activity size={17} /></div></div><strong className="stat-value-small">Invoice status</strong><div className="stat-note">Trained {dateLabel(result.as_of_date)}</div></div>
          </div>
          <section className="panel model-results-panel">
            <div className="panel-heading"><div><h2>Training set</h2><p>Class distribution and source invoice labels</p></div></div>
            <div className="model-class-counts">
              {Object.entries(result.class_counts).map(([label, count]) => (
                <div className="model-class-count" key={label}><span className={`status-badge status-${label}`}><i />{label.replace("_", " ")}</span><strong>{count}</strong></div>
              ))}
            </div>
            <div className="table-scroll"><table><thead><tr><th>INVOICE</th><th>DUE DATE</th><th>TOTAL</th><th>TRAINING LABEL</th></tr></thead><tbody>
              {result.invoices.map((invoice) => <tr key={invoice.id}><td className="table-primary">Invoice #{invoice.id}</td><td>{dateLabel(invoice.due_date)}</td><td className="money-cell">{money(invoice.total, "INR")}</td><td><span className={`status-badge status-${invoice.status}`}><i />{invoice.status.replace("_", " ")}</span></td></tr>)}
            </tbody></table></div>
            <p className="model-note">{result.note}</p>
          </section>
        </>
      ) : (
        <section className="panel model-empty-panel">
          <div className="panel-heading"><div><h2>Ready to train</h2><p>Training runs on the backend and saves the model for this workspace.</p></div></div>
          <div className="model-empty-content"><div className="stat-icon purple"><Sparkles size={20} /></div><div><strong>4 invoice records available</strong><p>Press “Train model” to build a simple classifier and display the training set and class distribution here.</p></div></div>
        </section>
      )}
    </div>
  );
}

function ReportsPage({ token, notify }: { token: string; notify: (kind: "success" | "error", message: string) => void }) {
  const [{ startDate, endDate, today }, setDateRange] = useState(() => {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 5);
    const todayDate = now.toISOString().slice(0, 10);
    return { startDate: start.toISOString().slice(0, 10), endDate: todayDate, today: todayDate };
  });
  const [rows, setRows] = useState<{ month: string; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get<{ month: string; revenue: number }[]>(`/reports/revenue?start_date=${startDate}&end_date=${endDate}`, token)
      .then((report) => { if (active) setRows(report); })
      .catch((error: unknown) => { if (active) notify("error", error instanceof Error ? error.message : "Report could not load"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [startDate, endDate, token, notify]);

  const total = rows.reduce((sum, row) => sum + Number(row.revenue), 0);
  return (
    <div className="resource-page">
      <div className="page-heading resource-heading"><div><div className="eyebrow light-eyebrow"><BarChart3 size={14} /> FINANCIAL INSIGHTS</div><h1>Revenue reports<span className="heading-period">.</span></h1><p>Explore recorded payment revenue by month for a selected period.</p></div></div>
      <div className="report-controls panel"><label>From<input type="date" value={startDate} max={endDate} onChange={(event) => setDateRange((range) => ({ ...range, startDate: event.target.value }))} /></label><label>To<input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setDateRange((range) => ({ ...range, endDate: event.target.value }))} /></label></div>
      <div className="stats-grid report-stats"><div className="stat-card"><div className="stat-top"><span>Revenue in period</span><div className="stat-icon green"><ArrowDownLeft size={18} /></div></div><strong>{money(total)}</strong><div className="stat-note"><span className="stat-note-dot green" />Recorded payments only</div></div><div className="stat-card"><div className="stat-top"><span>Months with revenue</span><div className="stat-icon purple"><CalendarDays size={18} /></div></div><strong>{rows.length}</strong><div className="stat-note"><span className="stat-note-dot purple" />Monthly aggregation</div></div></div>
      <section className="panel report-panel"><div className="panel-heading"><div><h2>Revenue by month</h2><p>Based on recorded payment dates</p></div></div>{loading ? <LoadingState compact /> : rows.length ? <div className="table-scroll"><table><thead><tr><th>MONTH</th><th>REVENUE RECEIVED</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month}><td className="table-primary">{row.month}</td><td className="money-cell">{money(row.revenue)}</td></tr>)}</tbody></table></div> : <EmptyState title="No revenue in this period" detail="Recorded customer payments will appear in this report." compact />}</section>
    </div>
  );
}

function AuthPage({ onAuthenticated, notify, notice }: { onAuthenticated: (token: string, user: User) => void; notify: (kind: "success" | "error", message: string) => void; notice: Notice }) {
  const [register, setRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = register
        ? await api.post<{ access_token: string; user: User }>("/auth/register", { email, password, full_name: fullName })
        : await api.post<{ access_token: string; user: User }>("/auth/login", { email, password });
      onAuthenticated(result.access_token, result.user);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not authenticate");
    } finally { setLoading(false); }
  };

  return (
    <>
    <div className="auth-page">
      <div className="auth-art">
        <div className="auth-brand"><div className="brand-mark"><Activity size={21} strokeWidth={2.6} /></div><strong>subscript<span>iq</span></strong></div>
        <div className="auth-art-content">
          <div className="eyebrow"><Sparkles size={14} /> THE REVENUE OPERATING SYSTEM</div>
          <h1>Every recurring<br />dollar, <em>in sync.</em></h1>
          <p>One calm place to manage subscriptions, billing, and customer relationships.</p>
          <div className="auth-preview">
            <div className="preview-head"><div><span className="preview-label">YOUR REVENUE WORKSPACE</span><strong>All in one place.</strong></div><span className="growth-tag"><ShieldCheck size={13} /> Connected</span></div>
            <div className="preview-features"><span><Zap size={15} /> Subscription lifecycle</span><span><FileText size={15} /> Recurring invoices</span><span><CreditCard size={15} /> Payment tracking</span></div>
          </div>
          <div className="auth-proof"><div className="proof-avatars"><i>J</i><i>A</i><i>M</i><i>+</i></div><span>Built for teams who run on recurring revenue.</span></div>
        </div>
        <div className="auth-decoration decor-one" /><div className="auth-decoration decor-two" />
      </div>
      <div className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><div className="brand-mark"><Activity size={20} /></div><strong>subscript<span>iq</span></strong></div>
          <div className="auth-form-heading"><div className="auth-welcome-icon"><Zap size={19} /></div><p className="eyebrow light-eyebrow">{register ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</p><h2>{register ? "Start your workspace" : "Sign in to your workspace"}</h2><p>{register ? "Create a customer portal account to view your subscriptions and invoices." : "Your business is in good hands. Pick up where you left off."}</p></div>
          <form onSubmit={submit} className="auth-form">
            {register && <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Alex Morgan" required autoComplete="name" /></label>}
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={register ? "At least 9 characters" : "Enter your password"} required autoComplete={register ? "new-password" : "current-password"} minLength={register ? 9 : 1} /></label>
            {register && <small className="password-note">Use uppercase, lowercase, and a special character.</small>}
            {!register && <div className="form-meta"><span>Secure sign-in</span><span>JWT protected</span></div>}
            <button type="submit" className="button button-primary auth-submit" disabled={loading}>{loading ? "Please wait..." : register ? "Create account" : "Sign in"} <ChevronRight size={17} /></button>
          </form>
          <div className="auth-switch">{register ? "Already have an account?" : "New to SubscriptIQ?"} <button onClick={() => setRegister(!register)}>{register ? "Sign in" : "Create account"}</button></div>
          <div className="auth-legal"><ShieldCheck size={14} /> Protected by enterprise-grade security</div>
        </div>
      </div>
    </div>
    {notice && <div className={`toast toast-${notice.kind}`}><span className="toast-icon">{notice.kind === "success" ? <Check size={16} /> : <X size={16} />}</span>{notice.text}</div>}
    </>
  );
}

function DashboardPage({ token, user, onNavigate, notify }: { token: string; user: User; onNavigate: (page: PageKey) => void; notify: (kind: "success" | "error", message: string) => void }) {
  const [todayLabel] = useState(() => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
  const [summary, setSummary] = useState<Dashboard | null>(null);
  const [payments, setPayments] = useState<Row[]>([]);
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [subscriptions, setSubscriptions] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<Dashboard>("/dashboard", token),
      api.get<Row[]>("/payments?limit=100", token),
      api.get<Row[]>("/invoices?limit=100", token),
      api.get<Row[]>("/subscriptions?limit=100", token),
    ]).then(([data, payRows, invoiceRows, subscriptionRows]) => {
      if (!alive) return;
      setSummary(data); setPayments(payRows); setInvoices(invoiceRows); setSubscriptions(subscriptionRows);
    }).catch((error: unknown) => {
      if (alive) notify("error", error instanceof Error ? error.message : "Dashboard could not load");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, notify]);

  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      const date = new Date(String(payment.paid_at));
      if (Number.isNaN(date.getTime())) continue;
      const month = date.toLocaleString("en", { month: "short" });
      map.set(month, (map.get(month) ?? 0) + Number(payment.amount ?? 0));
    }
    return [...map.entries()].slice(0, 6).reverse().map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));
  }, [payments]);

  if (loading) return <LoadingState />;
  if (!summary) return <ErrorState message="Dashboard data is unavailable for this account." />;

  const invoiceCurrencies = new Set(invoices.map((invoice) => String(invoice.currency ?? "USD")));
  const dashboardCurrency = invoiceCurrencies.size === 1 ? [...invoiceCurrencies][0] : "USD";
  const stats = user.role === "customer"
    ? [
      { label: "My subscriptions", value: subscriptions.length, icon: Zap, tone: "purple", note: `${subscriptions.filter((item) => item.status === "active").length} active` },
      { label: "Open invoices", value: invoices.filter((item) => Number(item.outstanding_amount) > 0).length, icon: FileText, tone: "blue", note: `${invoices.filter((item) => item.status === "overdue").length} overdue` },
      { label: "Payments made", value: payments.length, icon: CreditCard, tone: "green", note: money(payments.reduce((sum, item) => sum + Number(item.amount ?? 0), 0), dashboardCurrency) + " total" },
      { label: "Amount due", value: money(invoices.reduce((sum, item) => sum + Number(item.outstanding_amount ?? 0), 0), dashboardCurrency), icon: BadgeDollarSign, tone: "orange", note: "Across all invoices" },
    ]
    : [
      { label: "Total customers", value: summary.customers, icon: Users, tone: "purple", note: "Customer accounts" },
      { label: "Active subscriptions", value: summary.active_subscriptions, icon: Zap, tone: "blue", note: `${summary.upcoming_renewals} renew in 30 days` },
      { label: "Revenue collected", value: money(summary.revenue_received, dashboardCurrency), icon: ArrowDownLeft, tone: "green", note: "All recorded payments" },
      { label: "Outstanding", value: money(summary.outstanding_revenue, dashboardCurrency), icon: BadgeDollarSign, tone: "orange", note: `${summary.overdue_invoices} overdue invoices` },
    ];

  const recent = [...invoices].sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date))).slice(0, 5);
  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div><div className="eyebrow light-eyebrow"><CalendarDays size={14} /> {todayLabel}</div><h1>{user.role === "customer" ? `Welcome, ${user.full_name.split(" ")[0]}` : "Good morning, team"}<span className="heading-period">.</span></h1><p>{user.role === "customer" ? "Here's a clear view of your account and billing." : "Here's what's happening across your recurring revenue."}</p></div>
        <div className="heading-actions"><button className="button button-secondary" onClick={() => onNavigate("invoices")}><FileText size={16} /> View invoices</button>{user.role !== "customer" && <button className="button button-primary" onClick={() => onNavigate("subscriptions")}><Plus size={17} /> New subscription</button>}</div>
      </div>
      <div className="stats-grid">{stats.map(({ label, value, icon: Icon, tone, note }, index) => <div className="stat-card" key={label} style={{ animationDelay: `${index * 70}ms` }}><div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}><Icon size={18} /></div></div><strong className={typeof value === "string" && value.length > 10 ? "stat-value-small" : ""}>{value}</strong><div className="stat-note"><span className={`stat-note-dot ${tone}`} />{note}</div></div>)}</div>
      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="panel-heading"><div><h2>{user.role === "customer" ? "Payment activity" : "Collected revenue"}</h2><p>Recorded payment volume over time</p></div><button className="subtle-select">Last 6 months <ChevronDown size={14} /></button></div>
          <div className="chart-legend"><span><i /> Payments received</span>{chartData.length > 0 && <strong>{money(chartData.reduce((sum, item) => sum + item.revenue, 0), dashboardCurrency)}<small> total shown</small></strong>}</div>
          {chartData.length ? <div className="revenue-chart"><Suspense fallback={<LoadingState compact />}><RevenueChart data={chartData} formatMoney={(value) => money(value, dashboardCurrency)} /></Suspense></div> : <EmptyState title="Your revenue chart is ready" detail="Recorded payments will appear here as your business grows." compact />}
        </section>
        <section className="panel renewals-panel">
          <div className="panel-heading"><div><h2>Subscription health</h2><p>Current lifecycle overview</p></div><div className="panel-heading-icon"><Activity size={18} /></div></div>
          <div className="health-total"><strong>{subscriptions.length}</strong><span>total subscriptions</span></div>
          <div className="health-bar">{["active", "paused", "closed"].map((status) => { const count = subscriptions.filter((item) => item.status === status).length; const width = subscriptions.length ? `${Math.max(count / subscriptions.length * 100, count ? 4 : 0)}%` : "0%"; return <i key={status} className={`health-${status}`} style={{ width }} />; })}</div>
          <div className="health-legend">{[["active", "Active", "health-active"], ["paused", "Paused", "health-paused"], ["closed", "Closed", "health-closed"]].map(([key, label, color]) => <div key={key}><span><i className={color} />{label}</span><strong>{subscriptions.filter((item) => item.status === key).length}</strong></div>)}</div>
          <button className="text-link" onClick={() => onNavigate("subscriptions")}>View subscriptions <ArrowUpRight size={14} /></button>
        </section>
      </div>
      {user.role === "admin" && <DashboardModelWidget token={token} notify={notify} onOpen={() => onNavigate("model-training")} />}
      <section className="panel table-panel">
        <div className="panel-heading table-panel-heading"><div><h2>Recent invoices</h2><p>Your latest billing activity at a glance</p></div><button className="text-link" onClick={() => onNavigate("invoices")}>View all <ArrowUpRight size={14} /></button></div>
        {recent.length ? <div className="table-scroll"><table><thead><tr><th>INVOICE</th><th>ISSUED</th><th>DUE DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{recent.map((row) => <tr key={row.id}><td><span className="table-primary">{text(row.number)}</span></td><td>{dateLabel(row.invoice_date)}</td><td>{dateLabel(row.due_date)}</td><td className="money-cell">{money(row.total, String(row.currency ?? "USD"))}</td><td><StatusBadge value={String(row.status ?? "")} /></td></tr>)}</tbody></table></div> : <EmptyState title="No invoices yet" detail="Your created invoices will be listed here." compact /> }
      </section>
    </div>
  );
}

function DashboardModelWidget({ token, notify, onOpen }: { token: string; notify: (kind: "success" | "error", message: string) => void; onOpen: () => void }) {
  const [training, setTraining] = useState(false);
  const [trained, setTrained] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [total, setTotal] = useState("1500.00");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [prediction, setPrediction] = useState<ModelPredictionResult | null>(null);

  const train = async () => {
    setTraining(true);
    try {
      await api.post<ModelTrainingResult>("/model/train", {}, token);
      setTrained(true);
      setPrediction(null);
      notify("success", "Demo invoice model trained");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Model training failed");
    } finally {
      setTraining(false);
    }
  };

  const predictStatus = async (event: FormEvent) => {
    event.preventDefault();
    setPredicting(true);
    try {
      setPrediction(await api.post<ModelPredictionResult>("/model/predict", { total, due_date: dueDate }, token));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  };

  return (
    <section className="panel dashboard-model-panel">
      <div className="panel-heading">
        <div><h2>Invoice status predictor</h2><p>Train the demo model, then try an invoice total and due date.</p></div>
        <button className="text-link" onClick={onOpen}>Model details <ArrowUpRight size={14} /></button>
      </div>
      <div className="dashboard-model-content">
        <form className="dashboard-model-form" onSubmit={(event) => void predictStatus(event)}>
          <label>Invoice total (INR)<input type="number" min="0" step="0.01" value={total} onChange={(event) => setTotal(event.target.value)} required /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
          <button className="button button-primary" type="submit" disabled={!trained || predicting}>
            <Sparkles size={15} />{predicting ? "Predicting..." : "Predict status"}
          </button>
          <button className="button button-secondary" type="button" onClick={() => void train()} disabled={training}>
            <Activity size={15} />{training ? "Training..." : trained ? "Train again" : "Train model"}
          </button>
        </form>
        {prediction ? (
          <div className="dashboard-model-prediction" aria-live="polite">
            <span>Estimated status</span>
            <strong className={`status-badge status-${prediction.predicted_status}`}><i />{prediction.predicted_status.replace("_", " ")}</strong>
            <div className="model-probabilities">{Object.entries(prediction.probabilities).map(([label, probability]) => <div key={label}><span>{label}</span><strong>{Math.round(probability * 100)}%</strong></div>)}</div>
          </div>
        ) : (
          <p className="dashboard-model-hint">{trained ? "Enter invoice details and select Predict status." : "Train the model to enable invoice status predictions."}</p>
        )}
      </div>
      <p className="model-note">Demo only: trained on four sample invoices; predictions are not reliable for billing decisions.</p>
    </section>
  );
}

function ResourcePage({ page, token, user, notify }: { page: PageKey; token: string; user: User; notify: (kind: "success" | "error", message: string) => void }) {
  const config = resourceConfig[page];
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canCreate = Boolean(config?.fields.length && (config.permission !== "admin" || user.role === "admin") && (config.permission !== "staff" || user.role !== "customer"));

  const reload = useCallback(async () => {
    if (!config) return;
    try {
      const [data, customerData, planData, invoiceData, productData] = await Promise.all([
        api.get<Row[]>(config.endpoint, token),
        user.role !== "customer"
          ? api.get<Row[]>("/customers?limit=100", token).catch(() => [] as Row[])
          : api.get<Row>("/customers/me", token).then((customer) => [customer]).catch(() => [] as Row[]),
        api.get<Row[]>("/plans?limit=100&active=true", token).catch(() => [] as Row[]),
        api.get<Row[]>("/invoices?limit=100", token).catch(() => [] as Row[]),
        api.get<Row[]>("/products?limit=100&active=true", token).catch(() => [] as Row[]),
      ]);
      setRows(data); setCustomers(customerData); setPlans(planData); setInvoices(invoiceData); setProducts(productData);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("subscriptiq_token"); localStorage.removeItem("subscriptiq_user"); window.location.reload();
      } else notify("error", error instanceof Error ? error.message : "Could not load records");
    } finally { setLoading(false); }
  }, [config, token, user.role, notify]);

  // The initial data load is an intentional effect; the setters in reload run only after the API requests settle.
  // This effect synchronizes the table with API data when its resource or filters change.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const filtered = rows.filter((row) => {
    const matchesText = !query || (config?.searchable ?? []).some((key) => String(row[key] ?? "").toLowerCase().includes(query.toLowerCase()));
    return matchesText && (statusFilter === "all" || row.status === statusFilter);
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(pageNumber, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openNew = () => setModal(true);
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config) return;
    const formData = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      const raw = formData.get(field.key);
      if (raw === null || raw === "") continue;
      if (["price", "price_adjustment", "tax_rate", "amount"].includes(field.key)) payload[field.key] = Number(raw);
      else if (["quantity", "minimum_quantity", "product_id", "customer_id", "plan_id", "invoice_id"].includes(field.key)) payload[field.key] = Number(raw);
      else if (["auto_renew"].includes(field.key)) payload[field.key] = raw === "true";
      else payload[field.key] = raw;
    }
    if (page === "products") {
      const variantName = String(formData.get("variant_name") ?? "").trim();
      const variantPrice = Number(formData.get("variant_price") ?? 0);
      delete payload.variant_name; delete payload.variant_price;
      payload.variants = variantName ? [{ name: variantName, price_adjustment: variantPrice }] : [];
    }
    setSubmitting(true);
    try {
      if (page === "payments") {
        const invoiceId = payload.invoice_id;
        delete payload.invoice_id;
        await api.post(`/invoices/${invoiceId}/payments`, payload, token);
      } else {
        await api.post(config.endpoint.split("?")[0], payload, token);
      }
      setModal(false);
      notify("success", `${config.singular[0].toUpperCase() + config.singular.slice(1)} created`);
      await reload();
    } catch (error) { notify("error", error instanceof Error ? error.message : "Could not save this record"); }
    finally { setSubmitting(false); }
  };

  const subscriptionAction = async (row: Row, action: string) => {
    try {
      await api.post(`/subscriptions/${row.id}/${action}`, {}, token);
      notify("success", `Subscription ${action}d`);
      await reload();
    } catch (error) { notify("error", error instanceof Error ? error.message : "Action could not be completed"); }
  };

  const deactivateProduct = async (row: Row) => {
    try { await api.delete(`/products/${row.id}`, token); notify("success", "Product deactivated"); await reload(); }
    catch (error) { notify("error", error instanceof Error ? error.message : "Product could not be deactivated"); }
  };

  if (!config) return null;
  const Icon = config.icon;
  const filterStatuses = page === "subscriptions" ? ["active", "paused", "closed", "expired"] : page === "invoices" ? ["confirmed", "partially_paid", "paid", "overdue", "cancelled"] : [];
  return (
    <div className="resource-page">
      <div className="page-heading resource-heading"><div><div className="eyebrow light-eyebrow"><Icon size={14} /> WORKSPACE DATA</div><h1>{user.role === "customer" && page === "subscriptions" ? "Your subscriptions" : config.title}<span className="heading-period">.</span></h1><p>{resourceDescription(page, user.role)}</p></div>
        <div className="heading-actions">{page === "invoices" && user.role !== "customer" && <button className="button button-secondary" onClick={async () => { try { const result = await api.post<{ created: number }>("/billing/run", {}, token); notify("success", `${result.created} billing invoice${result.created === 1 ? "" : "s"} generated`); await reload(); } catch (error) { notify("error", error instanceof Error ? error.message : "Billing run failed"); } }}><Zap size={16} /> Run billing</button>}
        {canCreate && <button className="button button-primary" onClick={() => openNew()}><Plus size={17} /> New {config.singular}</button>}</div>
      </div>
      <div className="resource-summary-row"><div className="resource-total"><strong>{rows.length}</strong><span>{config.title.toLowerCase()} total</span></div><div className="resource-toolbar"><div className="search-box"><Search size={16} /><input placeholder={`Search ${config.title.toLowerCase()}...`} value={query} onChange={(e) => { setQuery(e.target.value); setPageNumber(1); }} /><kbd>⌘ K</kbd></div>{filterStatuses.length > 0 && <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPageNumber(1); }}><option value="all">All statuses</option>{filterStatuses.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select>}</div></div>
      <section className="panel resource-table-panel">
        {loading ? <LoadingState compact /> : filtered.length ? <div className="table-scroll"><table><thead><tr>{config.columns.map((col) => <th key={col.key}>{col.label.toUpperCase()}</th>)}{page === "subscriptions" && <th />}{page === "products" && user.role === "admin" && <th />}</tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id}>{config.columns.map((col) => <td key={col.key}>{renderCell(row, col.key, col.format, customers, plans, products)}</td>)}{page === "subscriptions" && <td><div className="row-actions">{row.status === "active" && <button onClick={() => void subscriptionAction(row, "pause")}>Pause</button>}{row.status === "paused" && <button onClick={() => void subscriptionAction(row, "resume")}>Resume</button>}{user.role !== "customer" && ["active", "paused"].includes(String(row.status)) && <button className="danger-text" onClick={() => void subscriptionAction(row, "close")}>Close</button>}</div></td>}{page === "products" && user.role === "admin" && Boolean(row.active) && <td><button className="row-menu-button" onClick={() => void deactivateProduct(row)}>Deactivate</button></td>}</tr>)}</tbody></table></div> : <EmptyState title={query ? "No matching records" : `No ${config.title.toLowerCase()} yet`} detail={query ? "Try a different search term or filter." : `Create your first ${config.singular} to see it listed here.`} action={canCreate && !query ? `Create ${config.singular}` : undefined} onAction={() => openNew()} />}
        {!loading && rows.length > 0 && <div className="table-footer"><span>Showing <strong>{filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> matching records</span><div><button disabled={currentPage === 1} aria-label="Previous page" onClick={() => setPageNumber(currentPage - 1)}><ChevronLeft size={15} /></button><button className="page-number">{currentPage}</button><button disabled={currentPage === pageCount} aria-label="Next page" onClick={() => setPageNumber(currentPage + 1)}><ChevronRight size={15} /></button></div></div>}
      </section>
      {modal && config.fields.length > 0 && <Modal title={`New ${config.singular}`} onClose={() => setModal(false)}><form className="modal-form" onSubmit={(event) => void submitForm(event)}>{config.fields.map((field) => <label key={field.key} className={field.type === "textarea" ? "form-full" : ""}>{field.label}{field.type === "select" ? <select name={field.key} defaultValue="" required={field.required}><option value="" disabled>Select {field.label.toLowerCase()}</option>      {field.options ? field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : field.key === "product_id" ? rowsForSelect(products, "name").map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : field.key === "customer_id" ? rowsForSelect(customers, "name").map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : field.key === "plan_id" ? rowsForSelect(plans, "name").map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : field.key === "invoice_id" ? invoices.filter((item) => Number(item.outstanding_amount) > 0).map((invoice) => <option key={invoice.id} value={invoice.id}>{text(invoice.number)} · {money(invoice.outstanding_amount, String(invoice.currency ?? "USD"))}</option>) : null}</select> : field.type === "textarea" ? <textarea name={field.key} placeholder={`Enter ${field.label.toLowerCase()}`} rows={3} /> : <input name={field.key} type={field.type ?? "text"} required={field.required} min={field.type === "number" ? "0" : undefined} step={["price", "variant_price", "tax_rate", "amount"].includes(field.key) ? "0.01" : field.type === "number" ? "1" : undefined} placeholder={field.hint ?? `Enter ${field.label.toLowerCase()}`} defaultValue={field.key === "currency" ? "USD" : field.key === "quantity" || field.key === "minimum_quantity" ? "1" : field.key === "tax_rate" || field.key === "variant_price" ? "0" : undefined} />}{field.hint && field.type !== "number" && <small>{field.hint}</small>}</label>)}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Saving..." : `Create ${config.singular}`} <ChevronRight size={15} /></button></div></form></Modal>}
    </div>
  );
}

function resourceDescription(page: PageKey, role: User["role"]) {
  if (role === "customer") return page === "subscriptions" ? "Manage your active plans and keep track of upcoming renewals." : "Review your personal billing history and account details.";
  const messages: Record<string, string> = {
    customers: "Keep customer records, contacts, and account details in one place.",
    products: "Manage the products and optional variants your business offers.",
    plans: "Set recurring pricing and billing intervals for your products.",
    subscriptions: "Track customer plans, renewal dates, and lifecycle changes.",
    invoices: "Review billed amounts, due dates, and outstanding balances.",
    payments: "A transparent ledger of every payment recorded against invoices.",
  };
  return messages[page] ?? "";
}

function renderCell(row: Row, key: string, format: string | undefined, customers: Row[], plans: Row[], products: Row[]) {
  const value = row[key];
  if (format === "money") return <span className="money-cell">{money(value, String(row.currency ?? "USD"))}</span>;
  if (format === "date") return dateLabel(value);
  if (format === "status") return <StatusBadge value={String(value ?? "")} />;
  if (format === "person") return <span className="table-primary">{text(value)}</span>;
  if (key === "customer_id") return text(customers.find((item) => item.id === Number(value))?.name ?? (customers.length === 0 ? `Customer #${text(value)}` : `#${text(value)}`));
  if (key === "plan_id") return text(plans.find((item) => item.id === Number(value))?.name ?? `Plan #${text(value)}`);
  if (key === "product_id") return text(products.find((item) => item.id === Number(value))?.name ?? `Product #${text(value)}`);
  if (key === "variants") return Array.isArray(value) ? (value.length ? value.map((variant) => (variant as Row).name).join(", ") : "No variants") : "—";
  if (typeof value === "boolean") return <StatusBadge value={value ? "active" : "inactive"} />;
  return text(value);
}

function rowsForSelect(rows: Row[], labelKey: string) {
  return rows.map((row) => ({ value: String(row.id), label: `${text(row[labelKey])} (#${row.id})` }));
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace("partially_paid", "partial");
  return <span className={`status-badge status-${normalized}`}><i />{value.replaceAll("_", " ") || "unknown"}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card"><div className="modal-heading"><div><span className="eyebrow light-eyebrow">WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>;
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  return <div className={`loading-state ${compact ? "loading-compact" : ""}`}><div className="spinner" /><span>Loading your workspace…</span></div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="panel error-state"><div className="empty-icon"><Settings2 size={21} /></div><h3>Something needs attention</h3><p>{message}</p></div>;
}

function EmptyState({ title, detail, action, onAction, compact = false }: { title: string; detail: string; action?: string; onAction?: () => void; compact?: boolean }) {
  return <div className={`empty-state ${compact ? "empty-compact" : ""}`}><div className="empty-icon"><BriefcaseBusiness size={20} /></div><h3>{title}</h3><p>{detail}</p>{action && onAction && <button className="button button-secondary" onClick={onAction}><Plus size={15} />{action}</button>}</div>;
}

export default App;
