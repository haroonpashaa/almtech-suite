import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { datetime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

export default function Activity() {
  const { data, isLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: async () => (await api.get('/activity')).data,
  });
  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Every action recorded with user and timestamp"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>}
      />
      <div className="page page-w">
        <Table
          loading={isLoading}
          empty="No activity recorded yet"
          columns={[
            { key: 'createdAt', label: 'When', render: (a) => <span className="text-ink-500 whitespace-nowrap">{datetime(a.createdAt)}</span> },
            { key: 'userName', label: 'User', render: (a) => <span className="font-medium text-ink-900">{a.userName || '—'}</span> },
            { key: 'action', label: 'Action', render: (a) => <span className="font-mono text-[12px] text-brand-700">{a.action}</span> },
            { key: 'entity', label: 'Entity', render: (a) => a.entity || <span className="text-ink-300">—</span> },
            { key: 'meta', label: 'Details', render: (a) => a.meta ? (
                <code className="text-[11px] text-ink-400 bg-ink-50 px-1.5 py-0.5 rounded">{JSON.stringify(a.meta)}</code>
              ) : <span className="text-ink-300">—</span> },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
