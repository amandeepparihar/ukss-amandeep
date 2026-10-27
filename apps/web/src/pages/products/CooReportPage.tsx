/**
 * Country-of-Origin (COO) Report — server-side paginated/filtered/sorted
 * DataTable read of `GET /api/products/coo-report`.
 *
 * Filters: COO Status (all/set/missing), Brand, Country of Origin, and a
 * global product-code search. All four map 1:1 onto the query params the
 * backend (coo-report.schema.ts) expects, and the `filters` object is built
 * once and used solely to drive the report query.
 *
 * Country of Origin is a server-side searchable combobox (mirrors the
 * typeahead on the New Product page — see ProductDetailsTab.tsx) that
 * queries `/products/countries?search=<term>` as the user types. This
 * replaces the old client-side faceted filter, which only ever loaded the
 * first 50 countries alphabetically (that endpoint is intentionally capped
 * since it's shared), so countries beyond that couldn't be selected.
 *
 * The `cooStatus` faceted filter has no corresponding *visible* table
 * column (COO status is derived). It's wired as a hidden display column
 * purely so DataTableToolbar's `table.getColumn(id)` lookup can attach a
 * faceted filter to it; it's force-hidden via `columnVisibility` and
 * excluded from the "View" column picker automatically (DataTableViewOptions
 * only lists columns that have an `accessorFn`, which this display column
 * doesn't).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ChevronsUpDown, ImageOff } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, DataTableColumnHeader, useDataTable, type FilterableColumn } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface CooRow {
  productListsId: number;
  productCode: string;
  productName: string | null;
  brand: string | null;
  countryOfOrigin: string | null;
  thumbnailUrl: string | null;
}

interface Manufacturer {
  manufacturers_id: number;
  manufacturers_name: string;
}

interface Country {
  countries_id: number;
  countries_name: string;
}

// Thumbnail cell: shows a placeholder when there's no image, and falls back
// to the placeholder if the image URL 404s / fails to load.
function ThumbCell({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      // Images are stored full-size; true thumbnails would need a
      // server-side resize endpoint — out of scope here. Defer loading and
      // decoding, and pin intrinsic dimensions to avoid layout shift.
      loading="lazy"
      decoding="async"
      width={40}
      height={40}
      className="h-10 w-10 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
}

export function CooReportPage() {
  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    queryParams,
  } = useDataTable({
    pageSize: 10,
    // Default (COO dashboard baseline): show only products that already have a
    // country assigned. Seeds the faceted filter so the "Set" chip is visible.
    initialColumnFilters: [{ id: 'cooStatus', value: ['set'] }],
  });

  // Hero-shirt children (~234k SEO variants) are excluded by default; this
  // toggle lets a user pull them into the report when needed.
  const [includeHeroShirts, setIncludeHeroShirts] = useState(false);

  // Brand dropdown options (master table, not hardcoded).
  const { data: brandsResp } = useQuery({
    queryKey: ['manufacturers'],
    queryFn: async () => (await api.get('/products/manufacturers')).data,
  });
  const brandOptions = (brandsResp?.data ?? []).map((m: Manufacturer) => ({
    label: m.manufacturers_name,
    value: String(m.manufacturers_id),
  }));

  // Country of Origin — server-side searchable combobox (mirrors New
  // Product page). Queries `/products/countries?search=<term>` as the user
  // types, rather than loading the (LIMIT 50) full list client-side.
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<{ id: string; name: string } | null>(null);

  const { data: countriesResp } = useQuery({
    queryKey: ['coo-countries', countrySearch],
    queryFn: async () =>
      (await api.get('/products/countries', { params: { search: countrySearch } })).data,
  });
  const countries = (countriesResp?.data ?? []) as Country[];

  // Built once and used solely to drive the report query.
  const filters = {
    brandId: queryParams.filters?.brand?.[0],
    countryId: selectedCountry?.id,
    // Fallback mirrors the backend default (coo-report.schema.ts): if the
    // faceted filter is cleared, the baseline COO-assigned view still applies.
    cooStatus: queryParams.filters?.cooStatus?.[0] ?? 'set',
    codeSearch: queryParams.search,
    includeHeroShirts,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['coo-report', queryParams, selectedCountry?.id, includeHeroShirts],
    queryFn: async () =>
      (
        await api.get('/products/coo-report', {
          params: {
            page: queryParams.page,
            pageSize: queryParams.limit,
            sortBy: queryParams.sortBy || 'coo',
            sortOrder: queryParams.sortOrder || 'asc',
            ...filters,
          },
        })
      ).data,
  });

  const rows: CooRow[] = data?.data || [];
  const pageCount = data?.meta?.totalPages || 0;

  const columns = useMemo<ColumnDef<CooRow>[]>(
    () => [
      {
        id: 'thumbnail',
        header: '',
        enableSorting: false,
        cell: ({ row }) => <ThumbCell url={row.original.thumbnailUrl} />,
      },
      {
        accessorKey: 'productCode',
        id: 'code',
        meta: { title: 'Product Code' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Product Code" />,
      },
      {
        accessorKey: 'productName',
        id: 'name',
        meta: { title: 'Product Name' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Product Name" />,
        cell: ({ row }) => row.original.productName || <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: 'brand',
        id: 'brand',
        meta: { title: 'Brand' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Brand" />,
        cell: ({ row }) => row.original.brand || <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: 'countryOfOrigin',
        id: 'coo',
        meta: { title: 'Country of Origin' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Country of Origin" />,
        cell: ({ row }) =>
          row.original.countryOfOrigin ? (
            <span>{row.original.countryOfOrigin}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      // Hidden filter-only column. It MUST expose a defined value via
      // accessorFn: DataTableFacetedFilter calls column.getFacetedUniqueValues(),
      // which throws "Cannot read properties of undefined (reading 'length')"
      // on an accessor-less column and blanks the entire page. enableHiding:false
      // keeps it out of the "View" menu; columnVisibility force-hides it from the
      // table body/header. (Filtering is server-side, so this value is never used
      // to filter client-side — it only feeds getFacetedUniqueValues safely.)
      {
        id: 'cooStatus',
        accessorFn: (row: CooRow) => (row.countryOfOrigin ? 'set' : 'missing'),
        enableSorting: false,
        enableHiding: false,
        cell: () => null,
      },
    ],
    []
  );

  const filterableColumns: FilterableColumn[] = [
    {
      id: 'cooStatus',
      title: 'COO Status',
      options: [
        { label: 'All', value: 'all' },
        { label: 'Set', value: 'set' },
        { label: 'Missing', value: 'missing' },
      ],
    },
    { id: 'brand', title: 'Brand', options: brandOptions },
  ];

  const toolbarControls = (
    <div className="flex items-center gap-4">
      {/* Country of Origin combobox + hero-shirt toggle share the toolbar's
          left slot so they sit with the other filters. */}
      <Popover open={countryOpen} onOpenChange={setCountryOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" role="combobox" className="justify-between">
          {selectedCountry?.name ?? 'Country of Origin'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search country..."
            value={countrySearch}
            onValueChange={setCountrySearch}
          />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  setSelectedCountry(null);
                  setCountryOpen(false);
                }}
              >
                <Check
                  className={cn('mr-2 h-4 w-4', !selectedCountry ? 'opacity-100' : 'opacity-0')}
                />
                All countries
              </CommandItem>
              {countries.map((c) => (
                <CommandItem
                  key={c.countries_id}
                  value={String(c.countries_id)}
                  onSelect={() => {
                    setSelectedCountry({ id: String(c.countries_id), name: c.countries_name });
                    setCountryOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedCountry?.id === String(c.countries_id) ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {c.countries_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      </Popover>
      <div className="flex items-center gap-2">
        <Switch
          id="include-hero-shirts"
          checked={includeHeroShirts}
          onCheckedChange={(checked) => {
            setIncludeHeroShirts(checked);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
        />
        <Label htmlFor="include-hero-shirts" className="whitespace-nowrap text-sm font-normal">
          Include hero shirts
        </Label>
      </div>
    </div>
  );

  return (
    // Fill the scroll area's height so the table body scrolls internally
    // instead of the whole page (paired with <DataTable fillHeight />).
    <div className="flex h-full flex-col">
      <PageHeader
        title="Country of Origin"
        description="Product codes and their Country of Origin, by brand"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Products' }, { label: 'Country of Origin' }]}
      />
      <DataTable
        columns={columns}
        data={rows}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        // cooStatus is always forced hidden — it exists only to anchor the
        // faceted filter (see file header comment).
        columnVisibility={{ ...columnVisibility, cooStatus: false }}
        onColumnVisibilityChange={setColumnVisibility}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        searchPlaceholder="Search product code..."
        filterableColumns={filterableColumns}
        toolbarLeft={toolbarControls}
        fillHeight
        getRowId={(row) => String(row.productListsId)}
        onReset={() => {
          setSelectedCountry(null);
          setCountrySearch('');
          setIncludeHeroShirts(false);
          // Reset returns to the default view (COO-assigned), not an empty
          // filter — re-seed after the toolbar's table.resetColumnFilters()
          // clears it. onReset runs last, so this wins.
          setColumnFilters([{ id: 'cooStatus', value: ['set'] }]);
        }}
        isFilteredExtra={!!selectedCountry || includeHeroShirts}
      />
    </div>
  );
}
