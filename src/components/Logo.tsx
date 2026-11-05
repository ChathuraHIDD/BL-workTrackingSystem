/**
 * Company logo. Replace /public/logo.jpg to rebrand; if the image fails to load,
 * the text wordmark is shown instead.
 */
import { useState } from 'react';

export function Logo({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`wordmark ${className}`}>
        Battery<strong>Lab</strong> <small>Energy</small>
      </span>
    );
  }
  return <img src="/logo.jpg" alt="Battery Lab — Automotive Energy Systems" className={`logo ${className}`} onError={() => setFailed(true)} />;
}
