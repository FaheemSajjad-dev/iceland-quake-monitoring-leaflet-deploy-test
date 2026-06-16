import { useState } from 'react';
import MapTypeSelector from './MapTypeSelector';
import TimeWindowSlider from './TimeWindowSlider';
import MagnitudeScale from './MagnitudeScale';
import { useLang, useT } from '../i18n';
import VolcanoIcon from './VolcanoIcon';
import './LeftPanel.css';

const LeftPanel = ({
  onMapTypeChange,
  showVolcanoes,
  toggleVolcanoes,
  showGrid,
  onShowGridChange,
  showFaults,
  onShowFaultsChange,
  colorOwner,
  onChangeColorOwner,
  isHeatmap,
  onFilterChange,
  minMagnitude,
  maxMagnitude,
  onMagnitudeFilterChange,
  onResetView,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const { lang, toggleLang } = useLang();
  const t = useT();

  return (
    <div className={`left-panel${collapsed ? ' left-panel--collapsed' : ''}`}>
      {/* White sidebar body */}
      <div className="left-panel__drawer">
        <div className="left-panel__body">
          <div className="left-panel__section">
            <MapTypeSelector onMapTypeChange={onMapTypeChange} />
          </div>

          {!isHeatmap && (
            <div className="left-panel__section">
              <span className="left-panel__label">{t('marker_colour')}</span>
              <div className="color-mode-switch">
                <button
                  className={colorOwner === 'timeline' ? 'active' : ''}
                  onClick={() => onChangeColorOwner('timeline')}
                >
                  {t('timeline')}
                </button>
                <button
                  className={colorOwner === 'magnitude' ? 'active' : ''}
                  onClick={() => onChangeColorOwner('magnitude')}
                >
                  {t('magnitude')}
                </button>
              </div>
            </div>
          )}

          <div className="left-panel__section">
            <span className="left-panel__label">{t('overlays')}</span>
            <div className="volcano-toggle">
              <label className="switch">
                <input type="checkbox" checked={showVolcanoes} onChange={toggleVolcanoes} />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label"><VolcanoIcon size={14} /> {t('volcanoes')}</span>
            </div>
            <div className="volcano-toggle grid-toggle">
              <label className="switch">
                <input type="checkbox" checked={showGrid} onChange={onShowGridChange} />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label">⊞ {t('lat_long_grid')}</span>
            </div>
            {!isHeatmap && (
              <div className="volcano-toggle faults-toggle">
                <label className="switch">
                  <input type="checkbox" checked={showFaults} onChange={onShowFaultsChange} />
                  <span className="slider round"></span>
                </label>
                <span className="toggle-label"><span className="faults-toggle-icon" aria-hidden="true">╱</span> {t('faults')}</span>
              </div>
            )}
            <div className="left-panel__action-row">
              <button className="reset-view-btn" onClick={() => window.location.reload()} title={t('reload_page')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
              <button className="reset-view-btn default-location-btn" onClick={onResetView} title={t('default_location')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v4"/>
                  <path d="M12 18v4"/>
                  <path d="M2 12h4"/>
                  <path d="M18 12h4"/>
                </svg>
              </button>
              <button className="lang-toggle-btn" onClick={toggleLang} title="Toggle language">
                {lang === 'en' ? 'IS' : 'EN'}
              </button>
            </div>
          </div>

          <TimeWindowSlider
            onFilterChange={onFilterChange}
            colorOwner={colorOwner}
            vertical
            isHeatmap={isHeatmap}
          />
          <MagnitudeScale
            minMagnitude={minMagnitude}
            maxMagnitude={maxMagnitude}
            onMagnitudeFilterChange={onMagnitudeFilterChange}
            colorOwner={colorOwner}
            isHeatmap={isHeatmap}
          />
        </div>
      </div>

      {/* Collapse / expand tab */}
      <button
        className="left-panel__toggle"
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? t('show_controls') : t('hide_controls')}
      >
        {collapsed ? '▶' : '◀'}
      </button>
    </div>
  );
};

export default LeftPanel;
