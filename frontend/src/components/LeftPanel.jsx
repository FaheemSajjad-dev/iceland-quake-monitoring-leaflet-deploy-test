import { useEffect, useState } from 'react';
import MapTypeSelector from './MapTypeSelector';
import TimeWindowSlider from './TimeWindowSlider';
import MagnitudeScale from './MagnitudeScale';
import { useLang, useT } from '../i18n';
import VolcanoIcon from './VolcanoIcon';
import './LeftPanel.css';

const LeftPanel = ({
  onMapTypeChange,
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
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  ));
  const { lang, toggleLang } = useLang();
  const t = useT();

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const handleChange = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileDrawerOpen(false);
    };
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('quake-map-ui-resize'));
    }, 280);
    return () => clearTimeout(id);
  }, [mobileDrawerOpen, collapsed]);

  return (
    <div className={`left-panel${collapsed ? ' left-panel--collapsed' : ''}${mobileDrawerOpen ? ' left-panel--mobile-open' : ''}`}>
      <button
        className="left-panel__filters-button"
        onClick={() => setMobileDrawerOpen(true)}
        aria-expanded={mobileDrawerOpen}
      >
        {t('filters')}
      </button>
      <button
        className="left-panel__scrim"
        onClick={() => setMobileDrawerOpen(false)}
        aria-label={t('hide_controls')}
        tabIndex={mobileDrawerOpen ? 0 : -1}
      />
      {/* White sidebar body */}
      <aside className="left-panel__mobile-shell" aria-hidden={isMobile && !mobileDrawerOpen}>
      <div className="left-panel__drawer">
        <div className="left-panel__body">
          <div className="left-panel__section">
            <MapTypeSelector onMapTypeChange={onMapTypeChange} selectedType={mapType} />
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
              <button className="lang-toggle-btn" onClick={toggleLang} title="Toggle language">
                {lang === 'en' ? 'IS' : 'EN'}
              </button>
            </div>
          </div>

          <div className="left-panel__range-controls">
            <TimeWindowSlider
              onFilterChange={onFilterChange}
              colorOwner={colorOwner}
              mapType={mapType}
              vertical={!isMobile}
              isHeatmap={isHeatmap}
            />
            <MagnitudeScale
              minMagnitude={minMagnitude}
              maxMagnitude={maxMagnitude}
              onMagnitudeFilterChange={onMagnitudeFilterChange}
              colorOwner={colorOwner}
              isHeatmap={isHeatmap}
              vertical={!isMobile}
            />
          </div>
        </div>
      </div>
      </aside>

      <div className="left-panel__map-actions">
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

      {/* Collapse / expand tab */}
      <button
        className="left-panel__toggle"
        onClick={() => {
          if (isMobile) setMobileDrawerOpen(v => !v);
          else setCollapsed(v => !v);
        }}
        title={collapsed ? t('show_controls') : t('hide_controls')}
      >
        {collapsed ? '▶' : '◀'}
      </button>
    </div>
  );
};

export default LeftPanel;
