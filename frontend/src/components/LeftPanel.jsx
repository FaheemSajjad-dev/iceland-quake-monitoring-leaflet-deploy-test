import { useEffect } from 'react';
import TimeWindowSlider from './TimeWindowSlider';
import MagnitudeScale from './MagnitudeScale';
import { useLang, useT } from '../i18n';
import VolcanoIcon from './VolcanoIcon';
import './LeftPanel.css';

const LeftPanel = ({
  mapType,
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
  onShowAbout,
  collapsed,
  onCollapsedChange,
}) => {
  const { lang, toggleLang } = useLang();
  const t = useT();

  useEffect(() => {
    const id = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('quake-map-ui-resize'));
    }, 280);
    return () => clearTimeout(id);
  }, [collapsed]);

  return (
    <div className={`left-panel${collapsed ? ' left-panel--collapsed' : ''}`}>
      <div className="left-panel__drawer">
        <div className="left-panel__body">

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

          </div>

          <div className="left-panel__range-controls">
            <div className="left-panel__scale-row">
              <TimeWindowSlider
                onFilterChange={onFilterChange}
                colorOwner={colorOwner}
                mapType={mapType}
                vertical
                isHeatmap={isHeatmap}
              />
              <MagnitudeScale
                minMagnitude={minMagnitude}
                maxMagnitude={maxMagnitude}
                onMagnitudeFilterChange={onMagnitudeFilterChange}
                colorOwner={colorOwner}
                isHeatmap={isHeatmap}
                vertical
              />
            </div>
            <div className="left-panel__range-help left-panel__range-help--time">
              Scroll to zoom time window, drag to shift
            </div>
            <div className="left-panel__range-help left-panel__range-help--magnitude">
              Set minimum magnitude of displayed events
            </div>
          </div>
        </div>
      </div>

      <div className="left-panel__map-actions">
        <button className="left-panel__map-action-btn about-action" onClick={onShowAbout} title={t('about')} aria-label={t('about')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5C4 4.7 4.7 4 5.5 4H10c1.1 0 2 .9 2 2v14c0-1.1-.9-2-2-2H5.5C4.7 18 4 17.3 4 16.5v-11Z" />
            <path d="M20 5.5C20 4.7 19.3 4 18.5 4H14c-1.1 0-2 .9-2 2v14c0-1.1.9-2 2-2h4.5c.8 0 1.5-.7 1.5-1.5v-11Z" />
            <path d="M12 6v14" />
          </svg>
        </button>
        <button className="left-panel__map-action-btn left-panel__map-action-btn--language" onClick={toggleLang} title="Toggle language" aria-label="Toggle language">
          {lang === 'en' ? 'IS' : 'EN'}
        </button>
        <button className="left-panel__map-action-btn" onClick={() => window.location.reload()} title={t('reload_page')} aria-label={t('reload_page')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>

        <button className="left-panel__map-action-btn default-location-btn" onClick={onResetView} title={t('default_location')} aria-label={t('default_location')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4"/>
            <path d="M12 18v4"/>
            <path d="M2 12h4"/>
            <path d="M18 12h4"/>
          </svg>
        </button>
      </div>

      <button
        className="left-panel__toggle"
        onClick={() => onCollapsedChange(v => !v)}
        title={collapsed ? t('show_controls') : t('hide_controls')}
      >
        {collapsed ? '▶' : '◀'}
      </button>
    </div>
  );
};

export default LeftPanel;
