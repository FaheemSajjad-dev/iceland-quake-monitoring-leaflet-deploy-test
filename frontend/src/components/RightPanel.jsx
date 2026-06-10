import { useT } from '../i18n';
import VolcanoIcon from './VolcanoIcon';
import './RightPanel.css';

const RightPanel = ({ volcanoes, selectedVolcano, onSelectVolcano, showVolcanoes, onToggleVolcanoes }) => {
  const t = useT();
  const collapsed = !showVolcanoes;

  const sorted = [...volcanoes].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  const handleItemClick = (v) => {
    onSelectVolcano(selectedVolcano?.name === v.name ? null : v);
  };

  return (
    <div className={`right-panel${collapsed ? ' right-panel--collapsed' : ''}`}>
      <button
        className="right-panel__toggle"
        onClick={onToggleVolcanoes}
        title={collapsed ? 'Show volcanoes' : 'Hide volcanoes'}
      >
        {collapsed ? '◀' : '▶'}
      </button>

      <div className="right-panel__drawer">
        <div className="right-panel__body">
          <span className="right-panel__label"><VolcanoIcon size={14} /> {t('volcanoes')}</span>
          <div className="right-panel__list">
            {sorted.map((v, i) => (
              <button
                key={i}
                className={`right-panel__item${selectedVolcano?.name === v.name ? ' right-panel__item--selected' : ''}`}
                onClick={() => handleItemClick(v)}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
