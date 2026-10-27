import { useState, useEffect } from 'react';
import { Play, Loader2, CheckCircle, XCircle, RefreshCw, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, getApiError } from '@/lib/api';
import axios from 'axios';

interface Store {
  storeId: number;
  storeName: string;
  storeUrl: string | null;
}

interface JobResult {
  success: boolean;
  [key: string]: unknown;
}

type JobStatus = 'idle' | 'running' | 'success' | 'error';

interface JobConfig {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'POST' | 'GET';
  requiresStore?: boolean;
  parameters?: {
    name: string;
    label: string;
    type: 'select' | 'number' | 'text';
    options?: { value: string; label: string }[];
    default?: string | number;
  }[];
}

const jobConfigs: JobConfig[] = [
  {
    id: 'create-new-products-on-shopify-table',
    name: 'Create New Products On Shopify Table',
    description: 'Create New Products On Shopify Table',
    endpoint: '/shopify_products/stage_products/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'create-new-sizes-on-shopify-table',
    name: 'Create New Products Variants On Shopify Table',
    description: 'Create New Products Variants On Shopify Table',
    endpoint: '/shopify_products/stage_new_size/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'refresh-price-on-shopify-table',
    name: 'Refresh Product Price On Shopify Table',
    description: 'Refresh all the Product Prices On Shopify Table',
    endpoint: '/shopify_products/refresh_price_in_shopify_tables',
    method: 'GET',
  },
  {
    id: 'create-products-on-shopify',
    name: 'Create Products On Shopify',
    description: 'Create staged products on Shopify',
    endpoint: '/shopify_products/create_products_on_shopify/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'update-product-details-on-shopify',
    name: 'Update Product Details On Shopify',
    description: 'Push product detail updates to Shopify',
    endpoint: '/shopify_products/update_product_detail_on_shopify/{storeId}/{fetchType}',
    method: 'GET',
    requiresStore: true,
    parameters: [
      {
        name: 'fetchType',
        label: 'Update Scope',
        type: 'select',
        options: [
          { value: 'patial', label: 'Partial Products Only' },
          { value: 'all', label: 'All Products' },
        ],
        default: '0',
      },
    ],
  },
  {
    id: 'update-product-prices-on-shopify',
    name: 'Update Product Prices On Shopify',
    description: 'Push product price updates to Shopify',
    endpoint: '/shopify_products/update_price_on_shopify/{storeId}/{fetchType}',
    method: 'GET',
    requiresStore: true,
    parameters: [
      {
        name: 'fetchType',
        label: 'Update Scope',
        type: 'select',
        options: [
          { value: 'patial', label: 'Partial Products' },
          { value: 'all', label: 'All Products' },
        ],
        default: '0',
      },
    ],
  },
  {
    id: 'update-inventory-on-shopify',
    name: 'Update Inventory On Shopify',
    description: 'Push inventory updates to Shopify',
    endpoint: '/shopify_products/update_inventory_on_shopify/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'update-product-metafields-on-shopify',
    name: 'Update Product Metafields On Shopify',
    description: 'Push product metafield updates to Shopify',
    endpoint: '/shopify_products/update_metafields_on_shopify/{storeId}/{fetchType}',
    method: 'GET',
    requiresStore: true,
    parameters: [
      {
        name: 'fetchType',
        label: 'Update Scope',
        type: 'select',
        options: [
          { value: 'patial', label: 'Partial Products Only' },
          { value: 'all', label: 'All Products' },
        ],
        default: '0',
      },
    ],
  },
  {
    id: 'sync-sort-order-on-shopify',
    name: 'Sync Collection Sort Order On Shopify',
    description: 'Sync collection sort order with Shopify',
    endpoint: '/shopify_products/sync_sort_order_on_shopify/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'flag-stock-change',
    name: 'Flag Stock Changes',
    description: 'Identify and flag products with stock changes',
    endpoint: '/shopify_products/flag_stock_change',
    method: 'GET',
  },
  {
    id: 'enforce-inventory-policy-on-dead-sizes',
    name: 'Enforce Inventory Policy On Dead Sizes',
    description: 'Apply inventory policy changes to dead-size variants',
    endpoint: '/shopify_products/enforce_inventory_policy_on_dead_size/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'update-tags-and-google-labels',
    name: 'Update Tags And Google Labels',
    description: 'Recompute tags and Google labels for Shopify products',
    endpoint: '/shopify_products/update_tags_label_on_shopify_able/{storeId}',
    method: 'GET',
    requiresStore: true,
  },
  {
    id: 'purge-old-records',
    name: 'Purge Old Records',
    description: 'Remove old logs and historical records',
    endpoint: '/shopify_products/purge_all_records',
    method: 'GET',
  },
  {
    id: 'fetch-shopify-orders',
    name: 'Fetch Shopify Orders',
    description: 'Fetch orders from Shopify stores and process them into the system',
    endpoint: '/shopify/stores/{storeId}/fetch-orders',
    method: 'POST',
    requiresStore: true,
    parameters: [
      {
        name: 'fetchType',
        label: 'Fetch Type',
        type: 'select',
        options: [
          { value: 'Partial', label: 'Partial (Since last order)' },
          { value: 'All', label: 'All (From beginning)' },
        ],
        default: 'Partial',
      },
    ],
  },
  {
    id: 'update-shopify-order-status',
    name: 'Update Shopify Order Status',
    description: 'Update order statuses (Fulfilled/Cancelled) to Shopify stores',
    endpoint: '/shopify/update-order-statuses',
    method: 'POST',
  },
  {
    id: 'process-marketplace-orders',
    name: 'Process Marketplace Orders',
    description: 'Process pending marketplace orders and convert them to UKSS orders',
    endpoint: '/marketplace-orders/process',
    method: 'POST',
    parameters: [
      {
        name: 'limit',
        label: 'Limit (optional)',
        type: 'number',
        default: undefined,
      },
    ],
  },
  {
    id: 'sync-order-status',
    name: 'Sync Order Status',
    description: 'Sync order statuses from UKSS orders to marketplace orders',
    endpoint: '/order-status-sync/sync',
    method: 'POST',
    parameters: [
      {
        name: 'limit',
        label: 'Limit (optional)',
        type: 'number',
        default: undefined,
      },
    ],
  },
  {
    id: 'fetch-toffs-orders',
    name: 'Fetch Toffs Orders',
    description:
      'Fetch orders from TOFFS (Magento2) and save in Marketplace orders and marketplace order products tables',
    endpoint: '/toffs/getToffsOrders',
    method: 'GET',
    parameters: [
      {
        name: 'orderId',
        label: 'Order ID (optional)',
        type: 'text',
        default: undefined,
      },
    ],
  },
  {
    id: 'update-toffs-order-status',
    name: 'Update TOFFS Order Status',
    description: 'Update order statuses (Shipped/Cancelled) to TOFFS (Magento2)',
    endpoint: '/toffs/update-order-statuses',
    method: 'POST',
  },
  {
    id: 'fetch-sportdeal-orders',
    name: 'Fetch Sportdeal Orders',
    description:
      'Fetch orders from Sportdeal and save in marketplace orders and marketplace order products tables',
    endpoint: '/sportdeal/getSportdealOrders',
    method: 'GET',
  },
  {
    id: 'update-sportdeal-order-status',
    name: 'Update Sportdeal Order Status',
    description: 'Update order statuses (Confirmed/Cancelled) to Sportdeal',
    endpoint: '/sportdeal/updateOrderStatus',
    method: 'POST',
  },
  {
    id: 'fetch-onbuy-orders',
    name: 'Fetch OnBuy Orders',
    description:
      'Fetch orders from OnBuy and save in marketplace orders and marketplace order products tables',
    endpoint: '/onbuy/getOnbuyOrders',
    method: 'GET',
  },
  {
    id: 'update-onbuy-order-status',
    name: 'Update OnBuy Order Status',
    description: 'Update order statuses (Shipped/Cancelled) to OnBuy',
    endpoint: '/onbuy/updateOrderStatus',
    method: 'POST',
  },
  {
    id: 'fetch-walmart-orders',
    name: 'Fetch Walmart Orders',
    description:
      'Fetch orders from Walmart Marketplace and save in marketplace orders and marketplace order products tables',
    endpoint: '/walmart/getWalmartOrders',
    method: 'GET',
  },
  {
    id: 'update-walmart-order-status',
    name: 'Update Walmart Order Status',
    description: 'Update order statuses (Confirmed/Shipped/Cancelled) to Walmart',
    endpoint: '/walmart/updateOrderStatus',
    method: 'POST',
  },
  {
    id: 'fetch-fruugo-orders',
    name: 'Fetch Fruugo Orders',
    description: 'Fetch orders from Fruugo and process them into the system',
    endpoint: '/fruugo/getFruugoOrders',
    method: 'GET',
    parameters: [
      {
        name: 'lastSevenDays',
        label: 'Last 7 Days',
        type: 'select',
        options: [
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ],
        default: 'false',
      },
    ],
  },
  {
    id: 'update-fruugo-order-statuses-to-fruugo',
    name: 'Update Fruugo Order Statuses to Fruugo',
    description: 'Update order statuses (Shipped/Cancelled) to Fruugo',
    endpoint: '/fruugo/updateFruugoOrderStatusesToFruugo',
    method: 'GET',
  },
  {
    id: 'fetch-ebay-orders',
    name: 'Fetch eBay Orders',
    description:
      'Fetch orders from eBay Trading API and save them in marketplace orders and marketplace order products tables',
    endpoint: '/ebay/getEbayOrders',
    method: 'GET',
  },
  {
    id: 'update-ebay-order-status',
    name: 'Update eBay Order Status',
    description: 'Push order status updates (shipped/cancelled) to eBay Trading API',
    endpoint: '/ebay/update-status',
    method: 'POST',
  },
  {
    id: 'fetch-allegro-orders',
    name: 'Fetch Allegro Orders',
    description:
      'Fetch orders from Allegro and save in marketplace orders and marketplace order products tables',
    endpoint: '/allegro/getAllegroOrders',
    method: 'GET',
    parameters: [
      {
        name: 'orderId',
        label: 'Order ID (optional)',
        type: 'text',
        default: undefined,
      },
    ],
  },
  {
    id: 'update-allegro-order-status',
    name: 'Update Allegro Order Status',
    description: 'Update order statuses (Shipped/Cancelled) to Allegro',
    endpoint: '/allegro/updateOrderStatus',
    method: 'POST',
  },
  {
    id: 'fetch-sd-orders',
    name: 'Fetch Seller Dynamics Orders',
    description:
      'Fetch orders from Seller Dynamics and save in marketplace orders and marketplace order products tables',
    endpoint: '/seller-dynamics/getSdOrders',
    method: 'GET',
  },
  {
    id: 'update-sd-order-status',
    name: 'Update Seller Dynamics Order Status',
    description:
      'Update order statuses (Shipped) to Seller Dynamics; cancel/reject orders trigger a manual-action email',
    endpoint: '/seller-dynamics/updateOrderStatus',
    method: 'POST',
  },
  {
    id: 'sd-tshirts-bulk-upload',
    name: 'SD T-Shirts Bulk Upload',
    description:
      'Fetches approved t-shirt listings with draft status and sends them to Seller Dynamics via bulk upload',
    endpoint: '/seller-dynamics-listing/run-bulk-upload',
    method: 'POST',
  },
  {
    id: 'sd-tshirts-sku-check',
    name: 'SD T-Shirts SKU Check',
    description:
      'Checks confirmed t-shirt listings against Seller Dynamics and updates their status to active',
    endpoint: '/seller-dynamics-listing/run-sku-check',
    method: 'POST',
  },
];

interface JobState {
  status: JobStatus;
  result: JobResult | null;
  error: string | null;
  startTime: Date | null;
  endTime: Date | null;
}

export function JobsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({});
  const [jobParams, setJobParams] = useState<Record<string, Record<string, unknown>>>({});

  // Initialize job states and params
  useEffect(() => {
    const initialStates: Record<string, JobState> = {};
    const initialParams: Record<string, Record<string, unknown>> = {};

    jobConfigs.forEach((job) => {
      initialStates[job.id] = {
        status: 'idle',
        result: null,
        error: null,
        startTime: null,
        endTime: null,
      };

      const params: Record<string, unknown> = {};
      if (job.requiresStore) {
        params.storeId = '';
      }
      job.parameters?.forEach((param) => {
        params[param.name] = param.default ?? '';
      });
      initialParams[job.id] = params;
    });

    setJobStates(initialStates);
    setJobParams(initialParams);
  }, []);

  // Fetch stores
  useEffect(() => {
    const fetchStores = async () => {
      try {
        console.log('Fetching stores from:', '/shopify/stores');
        console.log('API base URL:', import.meta.env.VITE_API_URL || '/api');


        const response = await api.get('/shopify/stores');


        console.log('=== STORES API RESPONSE DEBUG ===');
        console.log('Full response object:', response);
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        console.log('Response data (raw):', response.data);
        console.log('Response data type:', typeof response.data);
        console.log('Response data.data:', response.data?.data);
        console.log('Response data.data type:', typeof response.data?.data);
        console.log('Is response.data an array?', Array.isArray(response.data));
        console.log('Is response.data.data an array?', Array.isArray(response.data?.data));
        console.log('================================');


        // Handle different possible response structures
        let storesData: Store[] = [];


        if (Array.isArray(response.data)) {
          // Response is directly an array
          storesData = response.data;
          console.log('Using response.data directly (array)');
        } else if (Array.isArray(response.data?.data)) {
          // Response has data.data structure
          storesData = response.data.data;
          console.log('Using response.data.data (array)');
        } else if (response.data?.data && typeof response.data.data === 'object') {
          // Data might be an object, try to extract array
          console.warn('Response data.data is not an array:', response.data.data);
          storesData = [];
        } else {
          console.warn('Unexpected response structure:', response.data);
          storesData = [];
        }

        console.log('Final stores data to set:', storesData);
        console.log('Number of stores:', storesData.length);

        setStores(storesData);
      } catch (error) {
        console.error('=== ERROR FETCHING STORES ===');
        console.error('Error object:', error);
        if (axios.isAxiosError(error)) {
          console.error('Error response:', error.response);
          console.error('Error response data:', error.response?.data);
          console.error('Error status:', error.response?.status);
          console.error('Error headers:', error.response?.headers);
        }
        console.error('============================');

        const apiError = getApiError(error);
        toast.error('Failed to fetch stores', {
          description: apiError.message,
        });
      } finally {
        setLoadingStores(false);
      }
    };

    fetchStores();
  }, []);

  const updateJobState = (jobId: string, updates: Partial<JobState>) => {
    setJobStates((prev) => ({
      ...prev,
      [jobId]: { ...prev[jobId], ...updates },
    }));
  };

  const updateJobParam = (jobId: string, paramName: string, value: unknown) => {
    setJobParams((prev) => ({
      ...prev,
      [jobId]: { ...prev[jobId], [paramName]: value },
    }));
  };

  const runJob = async (job: JobConfig) => {
    const params = jobParams[job.id] || {};

    // Validate required params
    if (job.requiresStore && !params.storeId) {
      toast.error('Store required', {
        description: 'Please select a store to run this job',
      });
      return;
    }

    updateJobState(job.id, {
      status: 'running',
      result: null,
      error: null,
      startTime: new Date(),
      endTime: null,
    });

    try {
      let endpoint = job.endpoint;
      const body: Record<string, unknown> = {};
      const queryParams: Record<string, string> = {};

      // Replace path parameters
      if (job.requiresStore && params.storeId) {
        endpoint = endpoint.replace('{storeId}', String(params.storeId));
      }

      // Build request parameters (body for POST, query for GET)
      job.parameters?.forEach((param) => {
        const value = params[param.name];
        if (value !== '' && value !== undefined) {
          const paramValue = param.type === 'number' && value ? Number(value) : String(value);


          if (job.method === 'GET') {
            queryParams[param.name] = String(paramValue);
          } else {
            body[param.name] = paramValue;
          }
        }
      });

      // Build query string for GET requests
      let finalEndpoint = endpoint;
      if (job.method === 'GET' && Object.keys(queryParams).length > 0) {
        const queryString = new URLSearchParams(queryParams).toString();
        finalEndpoint = `${endpoint}?${queryString}`;
      }

      // Make request based on method
      const response =
        job.method === 'GET' ? await api.get(finalEndpoint) : await api.post(endpoint, body);

      updateJobState(job.id, {
        status: 'success',
        result: response.data.data,
        endTime: new Date(),
      });

      toast.success('Job completed', {
        description: response.data.message || 'Job completed successfully',
      });
    } catch (error) {
      const apiError = getApiError(error);
      updateJobState(job.id, {
        status: 'error',
        error: apiError.message,
        endTime: new Date(),
      });

      toast.error('Job failed', {
        description: apiError.message,
      });
    }
  };

  const resetJob = (jobId: string) => {
    updateJobState(jobId, {
      status: 'idle',
      result: null,
      error: null,
      startTime: null,
      endTime: null,
    });
  };

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-800">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      case 'success':
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case 'error':
        return (
          <Badge className="bg-red-100 text-red-800">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            Idle
          </Badge>
        );
    }
  };

  const formatDuration = (start: Date | null, end: Date | null) => {
    if (!start) return null;
    const endTime = end || new Date();
    const duration = endTime.getTime() - start.getTime();
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${(duration / 60000).toFixed(1)}m`;
  };

  const renderResult = (result: JobResult | null) => {
    if (!result) return null;

    return (
      <div className="mt-4 p-3 bg-muted rounded-lg">
        <h4 className="font-medium text-sm mb-2">Result:</h4>
        <div className="text-sm space-y-1">
          {Object.entries(result).map(([key, value]) => {
            if (key === 'success' || key === 'errors' || key === 'results') return null;
            return (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{key}:</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Background Jobs"
        description="Run and monitor background processing jobs"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Jobs' }]}
      />

      <div className="grid gap-6 md:grid-cols-2">
        {jobConfigs.map((job) => {
          const state = jobStates[job.id] || {
            status: 'idle',
            result: null,
            error: null,
            startTime: null,
            endTime: null,
          };
          const params = jobParams[job.id] || {};

          return (
            <Card key={job.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{job.name}</CardTitle>
                    <CardDescription className="mt-1">{job.description}</CardDescription>
                  </div>
                  {getStatusBadge(state.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Store selector */}
                {job.requiresStore && (
                  <div className="space-y-2">
                    <Label htmlFor={`${job.id}-store`}>
                      Store {stores.length > 0 && `(${stores.length} available)`}
                    </Label>
                    <Select
                      value={String(params.storeId || '')}
                      onValueChange={(value) => updateJobParam(job.id, 'storeId', value)}
                      disabled={state.status === 'running' || loadingStores}
                    >
                      <SelectTrigger id={`${job.id}-store`}>
                        <SelectValue
                          placeholder={
                            loadingStores
                              ? 'Loading stores...'
                              : stores.length === 0
                                ? 'No stores available'
                                : 'Select a store'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            {loadingStores ? 'Loading...' : 'No stores available'}
                          </div>
                        ) : (
                          stores.map((store) => (
                            <SelectItem key={store.storeId} value={String(store.storeId)}>
                              {store.storeName}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Job parameters */}
                {job.parameters?.map((param) => (
                  <div key={param.name} className="space-y-2">
                    <Label htmlFor={`${job.id}-${param.name}`}>{param.label}</Label>
                    {param.type === 'select' ? (
                      <Select
                        value={String(params[param.name] || '')}
                        onValueChange={(value) => updateJobParam(job.id, param.name, value)}
                        disabled={state.status === 'running'}
                      >
                        <SelectTrigger id={`${job.id}-${param.name}`}>
                          <SelectValue placeholder={`Select ${param.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {param.options?.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`${job.id}-${param.name}`}
                        type={param.type}
                        value={String(params[param.name] || '')}
                        onChange={(e) => updateJobParam(job.id, param.name, e.target.value)}
                        placeholder={`Enter ${param.label.toLowerCase()}`}
                        disabled={state.status === 'running'}
                      />
                    )}
                  </div>
                ))}

                {/* Duration */}
                {state.startTime && (
                  <div className="text-sm text-muted-foreground">
                    Duration: {formatDuration(state.startTime, state.endTime)}
                  </div>
                )}

                {/* Error message */}
                {state.error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{state.error}</p>
                  </div>
                )}

                {/* Result */}
                {state.status === 'success' && renderResult(state.result)}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => runJob(job)}
                    disabled={state.status === 'running'}
                    className="flex-1"
                  >
                    {state.status === 'running' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Run Job
                      </>
                    )}
                  </Button>
                  {(state.status === 'success' || state.status === 'error') && (
                    <Button variant="outline" onClick={() => resetJob(job.id)}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
