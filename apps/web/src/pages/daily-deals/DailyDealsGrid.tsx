/**
 * DailyDealsGrid — SlickGrid-powered compact spreadsheet grid
 *
 * Uses slickgrid-react with imperative data updates to work reliably
 * with React 18 StrictMode (which double-mounts components).
 */

import { useMemo, useRef, useEffect } from 'react';
import { SlickgridReact, type Column, type GridOption } from 'slickgrid-react';
import type { SlickgridReactInstance } from 'slickgrid-react';
import '@slickgrid-universal/common/dist/styles/css/slickgrid-theme-bootstrap.css';

interface DailyDealsGridProps {
  data: any[];
  sizeData: Record<number, Record<string, number>>;
  dealInfo: Record<number, { dealStatus: string | null; dealRevenue: number; dealUnitsSold: number }>;
  onAddDeal: (product: any) => void;
  onSetSpecial: (product: any) => void;
  onIgnoreToggle: (product: any) => void;
  showSizeColumn?: boolean;
}

const SIZE_KEYS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', 'XSB', 'SB', 'MB', 'LB', 'XLB'];

// Build column definitions outside React to avoid re-creation
function buildColumns(showSizeColumn: boolean): Column[] {
  const cols: Column[] = [
    {
      id: 'productCode',
      name: 'Code',
      field: 'productCode',
      width: 100,
      sortable: true,
      cssClass: 'font-mono text-[11px]',
    },
    {
      id: 'productName',
      name: 'Product Name',
      field: 'productName',
      width: 350,
      sortable: true,
      formatter: (_row, _cell, _value, _colDef, item) => {
        const name = item.productName || '';
        return `<span title="${name}" style="margin-right:4px;white-space:normal;line-height:1.3">${name}</span>`
          + `<a href="https://www.uksoccershop.com/products/${item.productsId}.html" target="_blank" rel="noopener noreferrer" title="View on Website" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;font-size:9px;font-weight:bold;border-radius:3px;background:#dbeafe;color:#1d4ed8;text-decoration:none;vertical-align:middle">W</a> `
          + `<a href="https://stock.uksoccershop.com/add_new_products/create_edit_product_form?pcode=${item.productCode}" target="_blank" rel="noopener noreferrer" title="Edit Product" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;font-size:9px;font-weight:bold;border-radius:3px;background:#fef3c7;color:#b45309;text-decoration:none;vertical-align:middle">E</a>`;
      },
    },
    ...SIZE_KEYS.map((key) => ({
      id: `size_${key}`,
      name: key,
      field: `size_${key}`,
      width: 38,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center text-[10px]',
      formatter: (_row: number, _cell: number, value: any) => {
        const qty = value || 0;
        return qty > 0
          ? `<span style="color:#15803d;font-weight:600">${qty}</span>`
          : `<span style="color:#d1d5db">0</span>`;
      },
    })),
    {
      id: 'currentPrice',
      name: 'Price',
      field: 'currentPrice',
      width: 65,
      sortable: true,
      cssClass: 'text-right',
      headerCssClass: 'text-right',
      formatter: (_row, _cell, value) => `£${(value || 0).toFixed(2)}`,
    },
    {
      id: 'sitePrice',
      name: 'Site Price',
      field: 'sitePrice',
      width: 75,
      sortable: true,
      cssClass: 'text-right',
      headerCssClass: 'text-right',
      formatter: (_row, _cell, value, _colDef, item) => {
        const onSale = value > 0 && value < item.currentPrice;
        if (onSale) {
          return `<span style="color:#dc2626;font-weight:600">£${value.toFixed(2)} <span style="font-size:8px;border:1px solid #fca5a5;border-radius:2px;padding:0 2px">Sale</span></span>`;
        }
        return `£${(value || 0).toFixed(2)}`;
      },
    },
    {
      id: 'totalStock',
      name: 'Stock',
      field: 'totalStock',
      width: 45,
      sortable: true,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
    },
    {
      id: 'totalSold',
      name: 'Sold',
      field: 'totalSold',
      width: 40,
      sortable: true,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
    },
  ];

  if (showSizeColumn) {
    cols.push({
      id: 'sizeName',
      name: 'Size',
      field: 'sizeName',
      width: 60,
      sortable: true,
      cssClass: 'text-center text-[10px]',
      headerCssClass: 'text-center',
    });
  }

  cols.push(
    {
      id: 'daysSinceLastSale',
      name: 'Days',
      field: 'daysSinceLastSale',
      width: 45,
      sortable: true,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: (_row, _cell, value) => {
        return value === null || value === undefined
          ? '<span style="color:#9ca3af">N/A</span>'
          : String(value);
      },
    },
    {
      id: 'dealStatus',
      name: 'Status',
      field: 'dealStatus',
      width: 55,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: (_row, _cell, value) => {
        if (value === 'Live') return '<span style="background:#16a34a;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px">Live</span>';
        if (value === 'Upcoming') return '<span style="background:#2563eb;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px">Soon</span>';
        return '<span style="color:#d1d5db">—</span>';
      },
    },
    {
      id: 'dealUnitsSold',
      name: 'Deal Qty',
      field: 'dealUnitsSold',
      width: 50,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center text-[10px]',
      formatter: (_row, _cell, value) => {
        return value !== null && value !== undefined
          ? String(value)
          : '<span style="color:#d1d5db">—</span>';
      },
    },
    {
      id: 'dealRevenue',
      name: 'Deal £',
      field: 'dealRevenue',
      width: 65,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center text-[10px]',
      formatter: (_row, _cell, value) => {
        return value !== null && value !== undefined
          ? `£${value.toFixed(2)}`
          : '<span style="color:#d1d5db">—</span>';
      },
    },
    {
      id: 'addDeal',
      name: '',
      field: 'id',
      width: 35,
      sortable: false,
      cssClass: 'text-center',
      formatter: () => {
        return '<button class="deal-add-btn" title="Schedule deal" style="color:#2563eb;font-weight:bold;font-size:14px;cursor:pointer;background:none;border:none;padding:0 4px;line-height:1">+</button>';
      },
    },
    {
      id: 'setSpecial',
      name: '',
      field: 'id',
      width: 30,
      sortable: false,
      cssClass: 'text-center',
      formatter: (_row, _cell, _value, _colDef, item) => {
        if (item.hasSpecial) {
          return '<button class="special-btn" title="Edit special price (active)" style="font-weight:bold;font-size:11px;cursor:pointer;border:none;padding:1px 4px;line-height:1;border-radius:3px;background:#dc2626;color:#fff">S</button>';
        }
        return '<button class="special-btn" title="Set special price" style="font-weight:bold;font-size:11px;cursor:pointer;border:none;padding:1px 4px;line-height:1;border-radius:3px;background:#e5e7eb;color:#6b7280">S</button>';
      },
    },
    {
      id: 'ignoreToggle',
      name: '',
      field: 'id',
      width: 30,
      sortable: false,
      cssClass: 'text-center',
      formatter: (_row, _cell, _value, _colDef, item) => {
        if (item.isIgnored) {
          return '<button class="ignore-btn" title="Restore product" style="font-weight:bold;font-size:11px;cursor:pointer;border:none;padding:1px 4px;line-height:1;border-radius:3px;background:#f97316;color:#fff">X</button>';
        }
        return '<button class="ignore-btn" title="Ignore product" style="font-weight:bold;font-size:11px;cursor:pointer;border:none;padding:1px 4px;line-height:1;border-radius:3px;background:#e5e7eb;color:#6b7280">X</button>';
      },
    },
  );

  return cols;
}

export function DailyDealsGrid({ data, sizeData, dealInfo, onAddDeal, onSetSpecial, onIgnoreToggle, showSizeColumn }: DailyDealsGridProps) {
  const onAddDealRef = useRef(onAddDeal);
  onAddDealRef.current = onAddDeal;
  const onSetSpecialRef = useRef(onSetSpecial);
  onSetSpecialRef.current = onSetSpecial;
  const onIgnoreToggleRef = useRef(onIgnoreToggle);
  onIgnoreToggleRef.current = onIgnoreToggle;
  const gridInstanceRef = useRef<SlickgridReactInstance | null>(null);

  // Flatten data: merge sizeData and dealInfo into each row
  const dataset = useMemo(() => {
    return data.map((product) => {
      const sizes = sizeData[product.productsId] || {};
      const info = dealInfo[product.productsId];
      const row: Record<string, any> = {
        id: product.productsId,
        ...product,
        dealStatus: info?.dealStatus || null,
        dealUnitsSold: info?.dealUnitsSold ?? null,
        dealRevenue: info?.dealRevenue ?? null,
      };
      for (const key of SIZE_KEYS) {
        row[`size_${key}`] = sizes[key] || 0;
      }
      return row;
    });
  }, [data, sizeData, dealInfo]);

  // Always create fresh columns (protects against SlickGrid dispose() nullifying them in StrictMode)
  const columnDefinitions = useMemo(() => buildColumns(!!showSizeColumn), [showSizeColumn]);

  const gridOptions = useMemo<GridOption>(() => ({
    enableSorting: true,
    enableCellNavigation: true,
    enableColumnReorder: false,
    enableAutoResize: false,
    forceFitColumns: false,
    rowHeight: 30,
    headerRowHeight: 35,
    enableHeaderMenu: false,
    enableGridMenu: false,
    enableColumnPicker: false,
    autoHeight: true,
  }), []);

  // Imperatively update data when dataset changes (bypasses SlickGrid's buggy prop comparison)
  useEffect(() => {
    const inst = gridInstanceRef.current;
    if (inst?.dataView && dataset.length > 0) {
      inst.dataView.setItems(dataset, 'id');
      inst.slickGrid?.invalidate();
      inst.slickGrid?.render();
    }
  }, [dataset]);

  // Handle click on "+" or "S" buttons
  const handleCellClick = (e: CustomEvent<{ eventData: any; args: any }>) => {
    const args = e.detail.args;
    const grid = args.grid;
    const colDef = grid.getColumns()[args.cell];
    const item = grid.getDataItem(args.row);
    if (!item) return;
    if (colDef?.id === 'addDeal') {
      onAddDealRef.current(item);
    } else if (colDef?.id === 'setSpecial') {
      onSetSpecialRef.current(item);
    } else if (colDef?.id === 'ignoreToggle') {
      onIgnoreToggleRef.current(item);
    }
  };

  // Capture grid instance on creation
  const handleGridCreated = (e: CustomEvent<any>) => {
    const instance = e.detail as SlickgridReactInstance;
    gridInstanceRef.current = instance;

    // Disable SlickGrid's internal horizontal scroll to avoid competing with our wrapper
    const viewport = instance.slickGrid?.getCanvasNode()?.parentElement;
    if (viewport) {
      viewport.style.overflowX = 'hidden';
    }
  };


  if (data.length === 0) {
    return <div className="text-center py-8 text-muted-foreground text-sm">No products found</div>;
  }

  // Fresh column clone every render to survive StrictMode double-mount
  const safeColumns = columnDefinitions.map(col => ({ ...col }));

  return (
    <div style={{ width: '100%', overflowX: 'auto', overscrollBehaviorX: 'contain', contain: 'paint layout', willChange: 'transform' }}>
      <SlickgridReact
        gridId={`dailyDealsGrid${showSizeColumn ? 'SS' : 'NS'}`}
        columnDefinitions={safeColumns}
        gridOptions={gridOptions}
        dataset={dataset}
        onClick={handleCellClick}
        onReactGridCreated={handleGridCreated}
      />
    </div>
  );
}
