import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function DealSelector({ value, onChange, id = 'deal-selector' }) {
  const { data: deals = [] } = useQuery({ queryKey: ['deal-options'], queryFn: async () => (await api.get('/deals/records/options')).data });
  return <div>
    <label htmlFor={id} className="label">Deal (optional)</label>
    <select id={id} className="select" value={value || ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">No deal</option>
      {deals.map((deal) => <option key={deal._id} value={deal._id}>{deal.identifier}{deal.description ? ` · ${deal.description}` : ''}</option>)}
    </select>
  </div>;
}
