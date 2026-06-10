import { useState } from 'react';
import { useT } from '../i18n';

const MapTypeSelector = ({ onMapTypeChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('roadmap');
    const t = useT();

    const handleTypeChange = (type) => {
        setSelectedType(type);
        onMapTypeChange(type);
        setIsOpen(false);
    };

    const getDisplayName = (type) => {
        switch(type) {
            case 'roadmap':   return t('map_map');
            case 'satellite': return t('map_satellite');
            case 'terrain':   return t('map_terrain');
            case 'gray':      return t('map_gray');
            case 'heatmap':   return t('map_heatmap');
            default: return type;
        }
    };

    return (
        <div
            className="map-type-selector"
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <button className="map-type-main">
                {getDisplayName(selectedType)}
            </button>
            {isOpen && (
                <div className="map-type-dropdown">
                    <button
                        className={`map-type-option ${selectedType === 'roadmap' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('roadmap')}
                    >
                        {t('map_map')}
                    </button>
                    <button
                        className={`map-type-option ${selectedType === 'satellite' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('satellite')}
                    >
                        {t('map_satellite')}
                    </button>

                    <button
                        className={`map-type-option ${selectedType === 'gray' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('gray')}
                    >
                        {t('map_gray')}
                    </button>
                    <button
                        className={`map-type-option ${selectedType === 'terrain' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('terrain')}
                    >
                        {t('map_terrain')}
                    </button>
                    <button
                        className={`map-type-option ${selectedType === 'heatmap' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('heatmap')}
                    >
                        {t('map_heatmap')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default MapTypeSelector;
