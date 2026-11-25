import React, { useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { ExternalLink, MapPin, Navigation } from 'lucide-react';

interface LibraryMapProps {
  lat: number;
  lng: number;
  libraryName: string;
  address: string;
  nearbyLandmarks?: string;
  openingHours: string;
  mapUrl?: string;
  ratingText?: string;
  quotaExceeded?: boolean;
}

const LibraryMarkerWithInfo: React.FC<{
  lat: number;
  lng: number;
  libraryName: string;
  address: string;
  openingHours: string;
}> = ({ lat, lng, libraryName, address, openingHours }) => {
  const [infoOpen, setInfoOpen] = useState(true);
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat, lng }}
        title={libraryName}
        onClick={() => setInfoOpen((prev) => !prev)}
      >
        <Pin background="#002046" borderColor="#FFFFFF" glyphColor="#FFFFFF" scale={1.2} />
      </AdvancedMarker>
      {infoOpen && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={270}
          onCloseClick={() => setInfoOpen(false)}
        >
          <div className="p-1 text-on-surface">
            <p className="font-semibold text-sm text-primary">{libraryName}</p>
            <p className="text-xs text-on-surface-variant mt-1">{address}</p>
            <p className="text-xs font-semibold text-secondary mt-1">{openingHours}</p>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const LibraryMap: React.FC<LibraryMapProps> = ({
  lat,
  lng,
  libraryName,
  address,
  nearbyLandmarks,
  openingHours,
  mapUrl,
  ratingText,
  quotaExceeded = false,
}) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const directionsUrl =
    mapUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

  if (!apiKey || quotaExceeded) {
    return (
      <div className="min-h-[300px] sm:h-[340px] w-full rounded-lg border border-outline-variant bg-surface-container-low dark:bg-slate-900 flex flex-col items-center justify-center p-4 sm:p-6 text-center shadow-sm">
        <div className="w-12 h-12 rounded-full bg-surface-container-lowest dark:bg-slate-800 flex items-center justify-center text-secondary mb-3 border border-outline-variant">
          <MapPin className="w-6 h-6" />
        </div>
        <h4 className="font-semibold text-primary dark:text-white text-base break-words">{libraryName}</h4>
        <p className="text-sm text-on-surface-variant dark:text-slate-300 max-w-md mt-1 break-words">{address}</p>
        {nearbyLandmarks && (
          <p className="text-xs text-secondary dark:text-blue-400 font-medium max-w-md mt-1 break-words">
            Landmarks: {nearbyLandmarks}
          </p>
        )}
        {ratingText && (
          <p className="text-xs font-semibold text-secondary mt-1 break-words">{ratingText}</p>
        )}
        <p className="text-xs font-mono text-outline mt-1 tabular-nums">
          Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors"
        >
          <Navigation className="w-4 h-4" />
          Open Google Maps Directions
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-[320px] w-full rounded-lg overflow-hidden border border-outline-variant shadow-sm">
        <APIProvider apiKey={apiKey} libraries={['marker']}>
          <GoogleMap
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            defaultCenter={{ lat, lng }}
            defaultZoom={15}
            gestureHandling="cooperative"
            className="w-full h-full"
          >
            <LibraryMarkerWithInfo
              lat={lat}
              lng={lng}
              libraryName={libraryName}
              address={address}
              openingHours={openingHours}
            />
          </GoogleMap>
        </APIProvider>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant px-1">
        <span className="min-w-0 break-words">
          {nearbyLandmarks || ratingText || 'Darbhanga · Mirzapur Chowk'}
        </span>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-secondary hover:text-primary font-semibold shrink-0"
        >
          Open in Google Maps <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
