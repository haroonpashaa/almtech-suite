import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { datetime, errorMessage } from '../lib/format.js';
import { formatBytes, formatDuration } from '../lib/bytes.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import { Badge, LoadingBlock, ErrorState, Spinner } from '../components/ui.jsx';

// Health data changes slowly and this is a manual-operator screen, not a live
// dashboard — 45s keeps it reasonably current without hammering the endpoint.
const AUTO_REFRESH_MS = 45_000;

const STATUS_TONE = { healthy: 'success', warning: 'warning', critical: 'danger' };
const STATUS_LABEL = { healthy: 'Healthy', warning: 'Warning', critical: 'Critical' };

function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'neutral'} dot>{STATUS_LABEL[status] || status || 'Unknown'}</Badge>;
}

// No shared progress-bar component exists yet in the design system; this is a
// small local one rather than a new file, since it is only used on this page.
function UsageBar({ percent }) {
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const tone = percent == null ? 'bg-ink-200' : percent >= 90 ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mt-2 h-1.5 rounded-full bg-ink-100 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Section({ title, children, actions }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between text-sm py-1">
      <span className="text-ink-500">{label}</span>
      <span className="num text-ink-900 font-medium text-right">{value}</span>
    </div>
  );
}

const RECORD_LABELS = {
  products: 'Products',
  customers: 'Customers',
  suppliers: 'Suppliers',
  invoices: 'Invoices',
  purchaseOrders: 'Purchase Orders',
  expenses: 'Expenses',
  financialTransactions: 'Financial Transactions',
};

const WARNING_TONE = { critical: 'danger', warning: 'warning' };

export default function SystemHealth() {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => (await api.get('/admin/system-health')).data,
    refetchInterval: AUTO_REFRESH_MS,
  });

  if (isLoading) return <LoadingBlock label="Checking system health…" />;
  if (isError || !data) {
    return (
      <div>
        <PageHeader title="System Health" subtitle="Operational overview of ALM Suite and its server" />
        <div className="page page-w">
          <ErrorState description={errorMessage(error)} onRetry={refetch} />
        </div>
      </div>
    );
  }

  const { application, disk, memory, cpu, database, recordCounts, pm2, backups, warnings, status, checkedAt } = data;

  return (
    <div>
      <PageHeader
        title="System Health"
        subtitle="Operational overview of ALM Suite and its server — read-only, Admin only"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2-8 4 16 2-8h6" /></svg>}
        actions={
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <><Spinner className="w-4 h-4" /> Refreshing…</> : 'Refresh'}
          </button>
        }
      />
      <div className="page page-w space-y-4">
        <p className="text-xs text-ink-400">
          Last checked {datetime(checkedAt)} · auto-refreshes every {Math.round(AUTO_REFRESH_MS / 1000)}s
          {dataUpdatedAt ? ` · updated ${datetime(dataUpdatedAt)}` : ''}
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Overall Status" value={<StatusBadge status={status} />} />
          <StatCard label="Disk Usage" value={disk?.available ? `${disk.usagePercent}%` : 'Unavailable'} hint={disk?.available ? `${formatBytes(disk.freeBytes)} free` : disk?.reason} />
          <StatCard label="RAM Usage" value={memory?.usagePercent != null ? `${memory.usagePercent}%` : 'Unavailable'} hint={memory ? `${formatBytes(memory.freeBytes)} free` : undefined} />
          <StatCard label="Database" value={database?.connected ? 'Connected' : 'Disconnected'} hint={database?.connected ? `${database.latencyMs ?? '—'} ms ping` : database?.state} />
          <StatCard label="Backend / API" value={application?.status === 'up' ? 'Up' : 'Unknown'} hint={application?.environment} />
          <StatCard label="Server Uptime" value={formatDuration(application?.osUptimeSeconds)} hint={`process ${formatDuration(application?.processUptimeSeconds)}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Server Resources">
            <div className="space-y-4">
              <div>
                <Row label="Disk" value={disk?.available ? `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}` : 'Unavailable'} />
                {disk?.available && <UsageBar percent={disk.usagePercent} />}
                {!disk?.available && <p className="text-xs text-ink-400 mt-1">{disk?.reason}</p>}
              </div>
              <div>
                <Row label="RAM" value={memory ? `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}` : 'Unavailable'} />
                {memory && <UsageBar percent={memory.usagePercent} />}
              </div>
              <div className="pt-1 border-t border-ink-100 space-y-0.5">
                <Row label="Node process memory (RSS)" value={memory ? formatBytes(memory.process.rss) : '—'} />
                <Row label="CPU cores" value={cpu?.count ?? '—'} />
                <Row label="Load average (1 / 5 / 15m)" value={cpu ? `${cpu.loadAverage['1m'].toFixed(2)} / ${cpu.loadAverage['5m'].toFixed(2)} / ${cpu.loadAverage['15m'].toFixed(2)}` : '—'} />
              </div>
            </div>
          </Section>

          <Section title="Application">
            <div className="space-y-0.5">
              <Row label="Environment" value={application?.environment ?? '—'} />
              <Row label="Version" value={application?.version || '—'} />
              <Row label="Commit" value={application?.commit ? <span className="font-mono text-[12px]">{application.commit}</span> : 'Unavailable'} />
              <Row label="Node version" value={application?.nodeVersion ?? '—'} />
              <Row label="Started" value={application?.startedAt ? datetime(application.startedAt) : '—'} />
              <Row label="Process uptime" value={formatDuration(application?.processUptimeSeconds)} />
              <Row label="Server (OS) uptime" value={formatDuration(application?.osUptimeSeconds)} />
            </div>
          </Section>

          <Section title="Database">
            <div className="space-y-0.5">
              <Row label="Status" value={<Badge tone={database?.connected ? 'success' : 'danger'} dot>{database?.state ?? 'unknown'}</Badge>} />
              <Row label="Database name" value={database?.name || '—'} />
              <Row label="Ping latency" value={database?.latencyMs != null ? `${database.latencyMs} ms` : '—'} />
              <Row label="Data size" value={database?.sizeBytes != null ? formatBytes(database.sizeBytes) : (database?.sizeUnavailableReason || 'Unavailable')} />
              <Row label="Storage size" value={database?.storageSizeBytes != null ? formatBytes(database.storageSizeBytes) : '—'} />
              <Row label="Collections" value={database?.collections ?? '—'} />
            </div>
          </Section>

          <Section title="Business Data">
            <div className="space-y-0.5">
              {Object.entries(RECORD_LABELS).map(([key, label]) => (
                <Row key={key} label={label} value={recordCounts?.[key] != null ? recordCounts[key].toLocaleString() : '—'} />
              ))}
            </div>
          </Section>

          <Section title="Process Manager (PM2)">
            {pm2?.managedByPm2 ? (
              <div className="space-y-0.5">
                <Row label="Managed by PM2" value="Yes" />
                <Row label="Process id" value={pm2.pmId} />
                <p className="text-xs text-ink-400 mt-2">{pm2.reason}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-400">{pm2?.reason || 'This process is not running under PM2.'}</p>
            )}
          </Section>

          <Section title="Backups">
            <Row label="Status" value={<Badge tone="neutral">{backups?.backupStatus?.replace('_', ' ') || 'unknown'}</Badge>} />
            {backups?.note && <p className="text-xs text-ink-400 mt-2">{backups.note}</p>}
          </Section>
        </div>

        <Section title={`Warnings${warnings?.length ? ` (${warnings.length})` : ''}`}>
          {!warnings?.length ? (
            <p className="text-sm text-ink-400">No warnings — every checked subsystem is within normal range.</p>
          ) : (
            <ul className="space-y-2">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge tone={WARNING_TONE[w.severity] || 'neutral'} dot className="mt-0.5 shrink-0">{w.severity}</Badge>
                  <span className="text-ink-700">{w.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
