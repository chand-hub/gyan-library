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
        <Pin background="#3D2C56" borderColor="#B5ADC6" glyphColor="#FFFFFF" scale={1.2} />
      </AdvancedMarker>
      {infoOpen && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={270}
          onCloseClick={() => setInfoOpen(false)}
        >
          <div className="p-1 text-slate-900">
            <p className="font-semibold text-sm text-[#1C0E29]">{libraryName}</p>
            <p className="text-xs text-slate-700 mt-1">{address}</p>
            <p className="text-xs font-semibold text-[#514871] mt-1">{openingHours}</p>
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
      <div className="h-[340px] w-full rounded-xl border border-[#7C7397]/60 bg-[#3D2C56] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#1C0E29] flex items-center justify-center text-[#B5ADC6] mb-3 border border-[#7C7397]">
          <MapPin className="w-6 h-6" />
        </div>
        <h4 className="font-semibold text-white text-base">{libraryName}</h4>
        <p className="text-sm text-[#CFCEDD] max-w-md mt-1">{address}</p>
        {ratingText && (
          <p className="text-xs font-semibold text-[#B5ADC6] mt-1">{ratingText}</p>
        )}
        <p className="text-xs text-[#9993AC] mt-1 tabular-nums">
          Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors"
        >
          <Navigation className="w-4 h-4" />
          Open Google Maps Directions
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-[320px] w-full rounded-xl overflow-hidden border border-[#7C7397]/60">
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
      <div className="flex items-center justify-between text-xs text-[#CFCEDD] px-1">
        <span>{ratingText || 'Darbhanga · Mirzapur Chowk'}</span>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#B5ADC6] hover:text-white font-semibold"
        >
          Open in Google Maps <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
