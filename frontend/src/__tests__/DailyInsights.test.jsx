import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { normalizeEarthquakes, aggregateByTime } from '../analysis/analysisData';
vi.mock('../analysis/AnalysisCharts', () => ({default: ({analysis}) => <output data-testid="series">{JSON.stringify(analysis.timeSeries)}</output>}));
vi.mock('../analysis/ResultsTables', () => ({default: () => null}));
vi.mock('../api', async (original) => ({...await original(), fetchInsightsLimits: vi.fn(async policy => ({depth_quality:policy,magnitude_limits:{minimum:3,maximum:5},depth_limits:{minimum:0,maximum:20}}))}));
import AnalysisPage from '../analysis/AnalysisPage';
const row=(dt,m,status='matched')=>({'Date-time':dt,Latitude:64,Longitude:-22,Depth:5,Mw_mean:m,status});
const rows=[row('2023-11-09 23:59:59.900',3),row('2023-11-10 00:00:00.000',4),row('2023-11-10 23:59:59.900',5,'v_only'),row('2023-11-12 00:00:00.000',3)];
it('daily aggregation uses UTC day boundaries, retains empty days and categories',()=>{
 const normalized=normalizeEarthquakes(rows);
 const series=aggregateByTime(normalized,'day',normalized,{startDate:'2023-11-09',endDate:'2023-11-12'});
 expect(series.map(x=>x.count)).toEqual([1,2,0,1]);
 expect(series[1]).toMatchObject({matched:1,mpgv_only:1,averageMagnitude:4.5,highestMagnitude:5});
});
it('Insights Day selection and Apply pass daily data through to charts',async()=>{
 render(<LangProvider><AnalysisPage earthquakes={rows} loading={false} loadError={false} onMap={()=>{}} onViewMap={()=>{}} onRetryData={()=>{}} /></LangProvider>);
 await waitFor(()=>expect(screen.getByLabelText('Time grouping')).toBeInTheDocument());
 fireEvent.change(screen.getByLabelText('Start date'),{target:{value:'2023-11-09'}});
 fireEvent.change(screen.getByLabelText('End date'),{target:{value:'2023-11-12'}});
 fireEvent.change(screen.getByLabelText('Time grouping'),{target:{value:'day'}});
 fireEvent.submit(screen.getByRole('button',{name:'Apply filters'}).closest('form'));
 await waitFor(()=>expect(JSON.parse(screen.getByTestId('series').textContent).map(x=>x.count)).toEqual([1,2,0,1]));
});
