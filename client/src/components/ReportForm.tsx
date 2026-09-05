import { useState } from 'react';
import { uploadReportPhoto } from '../lib/supabase';
import { api } from '../lib/api';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function ReportForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_PHOTO_TYPES.includes(selected.type)) {
      setFile(null);
      setError(`"${selected.name}" is not a supported image (JPEG, PNG, WebP, or GIF).`);
      return;
    }
    if (selected.size > MAX_PHOTO_BYTES) {
      setFile(null);
      setError(`"${selected.name}" is too large — photos must be under 8MB.`);
      return;
    }
    setError(null);
    setFile(selected);
  }

  function detectLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setError(null);
      },
      () => setError('Could not get your location — enable location access and try again.')
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // double-submit guard
    if (!file && !location) {
      setError('A photo and your location are required — add a photo and use "Use my current location".');
      return;
    }
    if (!file) {
      setError('A photo is required — attach a photo of the issue.');
      return;
    }
    if (!location) {
      setError('Your location is required — click "Use my current location" before submitting.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const photo_url = await uploadReportPhoto(file);
      const mlaLookup = await api.nearestMla(location.lat, location.lng).catch(() => null);

      await api.createReport({
        photo_url,
        description,
        lat: location.lat,
        lng: location.lng,
        ward: mlaLookup?.mla?.ward,
        constituency: mlaLookup?.mla?.constituency,
        mla_id: mlaLookup?.mla?.id,
      });

      setFile(null);
      setDescription('');
      setLocation(null);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <h2 style={{ marginBottom: 16 }}>Report an issue</h2>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          capture="environment"
          onChange={handleFileChange}
          disabled={submitting}
          style={{ display: 'block', marginTop: 4 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Description (optional — AI will describe it if left blank)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={submitting}
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        />
      </label>

      <button type="button" onClick={detectLocation} disabled={submitting} style={{ marginBottom: 12 }}>
        {location ? `📍 Location set (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})` : '📍 Use my current location'}
      </button>

      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: 10,
          cursor: submitting ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting && (
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              border: '2px solid #d1d5db',
              borderTopColor: '#111827',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'nagrik-spin 0.8s linear infinite',
            }}
          />
        )}
        {submitting ? 'Submitting…' : 'Submit report'}
      </button>

      <style>{`@keyframes nagrik-spin { to { transform: rotate(360deg); } }`}</style>
    </form>
  );
}

