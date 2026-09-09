import { useState } from 'react';
import { Upload as UploadIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';

export default function Import() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [source, setSource] = useState('Google Maps scrape');
  const [priority, setPriority] = useState('Warm');
  const [campaign, setCampaign] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError(''); setResult(null); setBusy(true);
    try {
      const data = await api.importPreview(file);
      setPreview(data);
      setMapping(data.suggestedMapping);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true); setError('');
    try {
      const data = await api.importCommit({ importId: preview.importId, mapping, defaults: { source, priority, campaign } });
      setResult(data);
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header"><h1>Import CSV</h1></div>

      {!preview && (
        <form className="card" onSubmit={handleUpload} style={{ maxWidth: 520 }}>
          <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
            Export your Google Sheet as CSV, then upload it here. You'll map columns on the next screen —
            headers don't need to match exactly. Leads with a phone number matching one already in the CRM are skipped automatically.
          </p>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={!file || busy} type="submit">
              <UploadIcon size={15} />{busy ? 'Reading…' : 'Upload & Preview'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={16} />{error}
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Map columns ({preview.rowCount} rows found)</h2>
          <table>
            <thead><tr><th>CRM Field</th><th>CSV Column</th></tr></thead>
            <tbody>
              {preview.fields.map((f) => (
                <tr key={f.key}>
                  <td>{f.label}{f.key === 'phone' && <span style={{ color: 'var(--red)' }}> *</span>}</td>
                  <td>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                    >
                      <option value="">— skip —</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ marginTop: 20 }}>Sample rows</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.sampleRows.map((row, i) => (
                  <tr key={i}>{preview.headers.map((h) => <td key={h}>{row[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 20 }}>Defaults for rows missing these fields</h2>
          <div className="toolbar">
            <label>Source <input value={source} onChange={(e) => setSource(e.target.value)} /></label>
            <label>Campaign <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Website Pitch" /></label>
            <label>Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ marginLeft: 6 }}>
                <option>Hot</option><option>Warm</option><option>Cold</option>
              </select>
            </label>
          </div>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!mapping.phone || busy} onClick={handleCommit}>
              {busy ? 'Importing…' : `Import ${preview.rowCount} Rows`}
            </button>
            <button className="btn" onClick={() => { setPreview(null); setFile(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 14, borderColor: 'var(--green)' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)' }}><CheckCircle2 size={17} />Import complete.</strong>
          <div style={{ marginTop: 8 }}>
            {result.imported} imported · {result.duplicates} duplicates skipped (matching phone already in CRM)
            {result.skippedNoPhone > 0 && ` · ${result.skippedNoPhone} skipped (no usable phone number)`}
            {' '}out of {result.total} rows.
          </div>
        </div>
      )}
    </div>
  );
}
