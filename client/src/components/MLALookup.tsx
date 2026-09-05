import { useState } from 'react';
import { api } from '../lib/api';

interface Mla {
  id: string;
  name: string;
  party?: string;
  constituency: string;
  ward?: string;
  contact_email?: string;
  contact_phone?: string;
  photo_url?: string;
}

export function MLALookup() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Mla[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { mlas } = await api.searchMla(query);
      setResults(mlas);
    } finally {
      setLoading(false);
    }
  }

  async function useMyLocation() {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setLoading(true);
      try {
        const { mla } = await api.nearestMla(pos.coords.latitude, pos.coords.longitude);
        setResults(mla ? [mla] : []);
      } finally {
        setLoading(false);
      }
    });
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <h2 style={{ marginBottom: 16 }}>Find your MLA</h2>

      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your constituency"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Search</button>
      </form>

      <button onClick={useMyLocation} style={{ marginBottom: 16 }}>
        📍 Use my current location instead
      </button>

      {loading && <p>Looking up…</p>}

      {results.map((mla) => (
        <div key={mla.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>{mla.name}</div>
          {mla.party && <div style={{ fontSize: 13, color: '#6b7280' }}>{mla.party}</div>}
          <div style={{ fontSize: 13, marginTop: 6 }}>{mla.constituency}{mla.ward ? ` · ${mla.ward}` : ''}</div>
          {mla.contact_phone && <div style={{ fontSize: 13, marginTop: 4 }}>📞 {mla.contact_phone}</div>}
          {mla.contact_email && <div style={{ fontSize: 13 }}>✉️ {mla.contact_email}</div>}
        </div>
      ))}
    </div>
  );
}
