<script setup lang="ts">
// The map canvas (task 6.3, ARCHITECTURE §8): the children of one unit shaded by the chosen metric, or a ward's PU
// points sized by supporters and coloured by coverage. MapLibre is imported here only, dynamically, and this component
// is used lazily, so no other page downloads it. No basemap (saves data); boundaries are GRID3 (CC BY-SA 4.0).
import type { Map as MapLibreMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import type { GeoFeatureCollection, PuPoint } from '~~/shared/types/geo'
import type { ChildMetric, ChildStats } from '~~/shared/types/stats'

const props = defineProps<{
  code: string
  metric: ChildMetric
  rows: ChildStats[]
  points: PuPoint[]
  breaks: number[]
  highlight: string | null
  label: string
}>()
const emit = defineEmits<{ select: [code: string], ready: [] }>()

const container = useTemplateRef<HTMLDivElement>('container')
let map: MapLibreMap | null = null
let hovered: string | null = null
const boundaries = new Map<string, GeoFeatureCollection>()

/** The boundary file for this level, fetched once (the service worker keeps it). */
async function boundaryFile(file: string): Promise<GeoFeatureCollection> {
  const cached = boundaries.get(file)
  if (cached) return cached
  const fc = await $fetch<GeoFeatureCollection>(file)
  boundaries.set(file, fc)
  return fc
}

/** A grey diagonal hatch for units without data (UX §3). */
function hatchImage(): ImageData {
  const size = 8
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#EDEDED'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#A3A3A3'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, size)
  ctx.lineTo(size, 0)
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

function bounds(fc: GeoFeatureCollection): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as [number, number]
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    else if (Array.isArray(c)) {
      c.forEach(visit)
    }
  }
  for (const f of fc.features) visit((f.geometry as { coordinates?: unknown }).coordinates)
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null
}

async function areas(): Promise<GeoFeatureCollection> {
  const { file } = childLayer(props.code)
  if (!file) return { type: 'FeatureCollection', features: [] }
  const all = await boundaryFile(file)
  const byCode = new Map(props.rows.map(r => [r.code, r]))
  const features = featuresUnder(all.features, props.code).map((f) => {
    const code = String(f.properties!.code)
    const row = byCode.get(code)
    const value = row ? metricValue(row, props.metric) : null
    return { ...f, properties: { code, color: colorOf(value, props.breaks), hasData: value !== null } }
  })
  return { type: 'FeatureCollection', features }
}

function pointsCollection(): GeoFeatureCollection {
  const max = Math.max(1, ...props.points.map(p => p.total))
  return {
    type: 'FeatureCollection',
    features: props.points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        code: p.code,
        color: colorOf(p.coverage, props.breaks),
        radius: 6 + 14 * Math.sqrt(p.total / max),
        estimated: p.locationEstimated,
      },
    })),
  }
}

async function draw(fit: boolean) {
  if (!map) return
  const fc = await areas()
  const pts = pointsCollection()
  ;(map.getSource('areas') as GeoJSONSource).setData(fc)
  ;(map.getSource('pus') as GeoJSONSource).setData(pts)
  if (fit) {
    const b = bounds(fc.features.length ? fc : pts)
    if (b) map.fitBounds(b, { padding: 24, duration: 0, maxZoom: 13 })
  }
}

function setHover(code: string | null) {
  if (!map) return
  for (const source of ['areas', 'pus']) {
    if (hovered) map.setFeatureState({ source, id: hovered }, { hover: false })
    if (code) map.setFeatureState({ source, id: code }, { hover: true })
  }
  hovered = code
}

onMounted(async () => {
  const [maplibre] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
  map = new maplibre.Map({
    container: container.value!,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F5F2EC' } }] },
    center: [8.5, 12],
    zoom: 5.5,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    renderWorldCopies: false,
    attributionControl: { compact: true, customAttribution: 'Boundaries © GRID3, CC BY-SA 4.0' },
  })
  map.touchZoomRotate.disableRotation()
  map.on('load', async () => {
    if (!map) return
    map.addImage('hatch', hatchImage())
    map.addSource('areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'code' })
    map.addSource('pus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'code' })
    map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', filter: ['==', ['get', 'hasData'], true], paint: { 'fill-color': ['get', 'color'] } })
    map.addLayer({ id: 'areas-nodata', type: 'fill', source: 'areas', filter: ['!=', ['get', 'hasData'], true], paint: { 'fill-pattern': 'hatch' } })
    map.addLayer({
      id: 'areas-line', type: 'line', source: 'areas',
      paint: { 'line-color': '#1F3A68', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0.8] },
    })
    map.addLayer({
      id: 'pus-circle', type: 'circle', source: 'pus',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['get', 'radius'],
        'circle-stroke-color': '#1F3A68',
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1],
        'circle-stroke-opacity': ['case', ['get', 'estimated'], 0.5, 1],
      },
    })
    const select = (e: MapMouseEvent & { features?: { properties: { code?: string } }[] }) => {
      const code = e.features?.[0]?.properties.code
      if (code) emit('select', code)
    }
    map.on('click', 'areas-fill', select)
    map.on('click', 'areas-nodata', select)
    map.on('click', 'pus-circle', select)
    await draw(true)
    emit('ready')
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

watch(() => props.code, () => void draw(true))
watch(() => [props.rows, props.points, props.metric, props.breaks], () => void draw(false))
watch(() => props.highlight, code => setHover(code))
</script>

<template>
  <div
    ref="container"
    class="h-full min-h-80 w-full"
    role="img"
    :aria-label="props.label"
    data-testid="map-canvas"
  />
</template>
