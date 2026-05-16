import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { datetime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

export default function Activity() {
  const { data } = useQuery({
    queryKey: ['activity'],
    queryFn: async () => (await api.get('/activity')).data,
  });
  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Every action recorded with user and timestamp" />
      <div className="p-6">
        <Table
          columns={[
            { key: 'createdAt', label: 'When', render: (a) => datetime(a.createdAt) },
            { key: 'userName', label: 'User' },
            { key: 'action', label: 'Action' },
            { key: 'entity', label: 'Entity' },
            { key: 'meta', label: 'Details', render: (a) => a.meta ? (
                <code className="text-xs text-slate-500">{JSON.stringify(a.meta)}</code>
              ) : '—' },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
