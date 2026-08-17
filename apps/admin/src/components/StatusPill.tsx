import { STATUS_LABELS, type ArticleStatus, type ValidationSeverity } from '../types';
import { Icon } from './Icon';

export function StatusPill({ status }: { status: ArticleStatus }) {
  return <span className={`status-pill status-${status}`}><i />{STATUS_LABELS[status]}</span>;
}

export function ValidationPill({ severity, count }: { severity: ValidationSeverity; count?: number }) {
  const icon = severity === 'error' ? 'warning' : severity === 'warning' ? 'warning' : 'info';
  const label = severity === 'error' ? 'Needs attention' : severity === 'warning' ? 'Review note' : 'Checks passed';
  return (
    <span className={`validation-pill validation-${severity}`}>
      <Icon name={icon} size={14} />
      {count ? `${count} ${label.toLowerCase()}` : label}
    </span>
  );
}
