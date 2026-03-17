import { useState } from 'react';

const MapTypeSelector = ({ onMapTypeChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('roadmap');

    const handleTypeChange = (type) => {
        setSelectedType(type);
        onMapTypeChange(type);
        setIsOpen(false);
    };

    const getDisplayName = (type) => {
        switch(type) {
            case 'roadmap': return 'Map';
            case 'satellite': return 'Satellite';
            case 'dark_mode': return 'Dark Mode';
            case 'heatmap': return 'Heatmap';
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
                        Map
                    </button>
                    <button 
                        className={`map-type-option ${selectedType === 'satellite' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('satellite')}
                    >
                        Satellite
                    </button>
                    <button
                        className={`map-type-option ${selectedType === 'dark_mode' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('dark_mode')}
                    >
                        Dark Mode
                    </button>
                    <button
                        className={`map-type-option ${selectedType === 'heatmap' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('heatmap')}
                    >
                        Heatmap
                    </button>
                </div>
            )}
        </div>
    );
};

export default MapTypeSelector;
