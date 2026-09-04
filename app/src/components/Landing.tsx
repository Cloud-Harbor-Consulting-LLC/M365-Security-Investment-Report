import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

interface Props {
  onSnapshot: (raw: unknown, sourceLabel: string) => void;
  onConnect: () => void;
  error: string | null;
}

export function Landing({ onSnapshot, onConnect, error }: Props): JSX.Element {
  const [dragging, setDragging] = useState(false);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onSnapshot(JSON.parse(String(reader.result)), file.name);
      } catch {
        onSnapshot(null, file.name);
      }
    };
    reader.readAsText(file);
  };

  const onDrop = (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  };

  const onPick = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file) readFile(file);
  };

  const loadSample = async () => {
    const sample = await import('@fixtures/premium-snapshot.json');
    onSnapshot(sample.default, 'sample tenant');
  };

  return (
    <div class="landing">
      <h2>See the security you already paid for</h2>
      <p class="lede">
        This tool reads a Microsoft 365 tenant and shows how much of the security capability those licences
        entitle you to is <strong>actually switched on</strong> — and what closing the gap is worth.{' '}
        <strong>It never writes to your tenant</strong>, and your data never leaves this browser.
      </p>

      <div class="ways">
        <button class="way" onClick={loadSample}>
          <h3>Explore the sample tenant</h3>
          <p>A synthetic tenant with the awkward cases built in. No sign-in, nothing to install.</p>
        </button>

        <button class="way" onClick={onConnect}>
          <h3>Connect to a tenant</h3>
          <p>Sign in and collect directly in the browser, using read-only permissions only.</p>
        </button>

        <div class="way" style="cursor:default">
          <h3>Load a snapshot</h3>
          <p>
            Run the read-only PowerShell collector yourself, then drop the file below. Nothing to consent, nothing
            to register.
          </p>
        </div>
      </div>

      <div
        class={dragging ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>
          <strong>Drop a snapshot here</strong>, or{' '}
          <label style="text-decoration:underline;cursor:pointer;color:var(--accent-ink)">
            choose a file
            <input type="file" accept="application/json,.json" onChange={onPick} style="display:none" />
          </label>
        </p>
        <p class="hint">
          Produce one with <code>Get-CHSISnapshot -Path snapshot.json</code>
        </p>
      </div>

      {error && (
        <div class="error" role="alert">
          <strong>That file could not be used</strong>
          {error}
        </div>
      )}

      <div class="trust">
        <strong>Read-only, and nowhere to send anything.</strong> There is no backend and no telemetry. The
        PowerShell collector issues Microsoft Graph GET requests exclusively, enforced by a test that fails the
        build if a mutating call is ever introduced.
      </div>
    </div>
  );
}
