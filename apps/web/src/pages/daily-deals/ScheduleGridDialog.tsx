import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useSchedule, useSaveDeal, useDeleteDeal, useProductSitePrice } from './hooks/useDailyDeals';

interface ScheduleProduct {
  productsId: number;
  productCode: string;
  productName: string;
  currentPrice: number;
  sitePrice?: number;
  sizeType?: string | null;
  npGender?: string | null;
}

interface ScheduledDeal {
  dealId: number;
  productsId: number;
  productCode: string;
  productName: string;
  discountType: string;
  discountValue: number;
  currentPrice: number;
  startDate: string;
  endDate: string;
  isActive: number;
  toBeActive: number;
  sizeType: string | null;
  npGender: string | null;
}

interface ScheduleGridDialogProps {
  product: ScheduleProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_DEALS_PER_DAY = 10;

function getWeekDates(startDate: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function formatDiscount(type: string, value: number): string {
  if (type === 'PERCENT') return `${value}% off`;
  return `£${value.toFixed(2)} off`;
}

function getDealBgColor(deal: ScheduledDeal): string {
  if (deal.npGender === 'Female') return 'bg-pink-200'; // Womens
  if (deal.sizeType === 'Kids') return 'bg-sky-200';    // Kids
  return 'bg-amber-100';                                 // Adults
}

export function ScheduleGridDialog({ product, open, onOpenChange }: ScheduleGridDialogProps) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [inputMode, setInputMode] = useState<'PERCENT' | 'FIXED' | 'FIXED_PRICE'>('PERCENT');
  const discountType: 'PERCENT' | 'FIXED' = inputMode === 'PERCENT' ? 'PERCENT' : 'FIXED';
  const [discountValue, setDiscountValue] = useState('');
  const [error, setError] = useState('');
  const [recentlyAddedDealId, setRecentlyAddedDealId] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const startDate = weekDates[0];
  const endDate = weekDates[6];

  const { data: scheduleData, isLoading } = useSchedule(startDate, endDate);
  const { data: sitePriceData } = useProductSitePrice(product.productsId);
  const freshSitePrice = sitePriceData?.data?.sitePrice || product.sitePrice || product.currentPrice;
  const isOnSale = sitePriceData?.data?.onSale || false;
  const saveDeal = useSaveDeal();
  const deleteDeal = useDeleteDeal();

  const today = new Date().toISOString().split('T')[0];

  // Clear highlight after 2 seconds
  useEffect(() => {
    if (recentlyAddedDealId !== null) {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setRecentlyAddedDealId(null);
      }, 2000);
    }
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [recentlyAddedDealId]);

  // Build lookup: date -> deals array
  const dealsByDate = useMemo(() => {
    const map: Record<string, ScheduledDeal[]> = {};
    if (scheduleData?.data) {
      for (const [date, deals] of Object.entries(scheduleData.data as Record<string, ScheduledDeal[]>)) {
        map[date] = deals;
      }
    }
    return map;
  }, [scheduleData]);

  const handlePrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const handleNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const validateDiscount = (): boolean => {
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) {
      setError(inputMode === 'FIXED_PRICE' ? 'Enter a valid price' : 'Enter a valid discount value');
      return false;
    }

    let discountedPrice: number;
    if (inputMode === 'PERCENT') {
      discountedPrice = product.currentPrice - (product.currentPrice * value / 100);
    } else if (inputMode === 'FIXED_PRICE') {
      discountedPrice = value; // The entered value IS the final price
    } else {
      discountedPrice = product.currentPrice - value;
    }

    if (discountedPrice <= 0) {
      setError(inputMode === 'FIXED_PRICE'
        ? `Price must be greater than £0`
        : `Discount too large — price would be £${discountedPrice.toFixed(2)}`);
      return false;
    }
    if (discountedPrice >= product.currentPrice) {
      setError(inputMode === 'FIXED_PRICE'
        ? `Price must be less than current price (£${product.currentPrice.toFixed(2)})`
        : `Must reduce price below £${product.currentPrice.toFixed(2)}`);
      return false;
    }

    setError('');
    return true;
  };

  const handleAddDeal = (date: string) => {
    if (!validateDiscount()) return;

    const value = parseFloat(discountValue);
    // For FIXED_PRICE, convert to FIXED discount: subtract entered price from current price
    const apiDiscountValue = inputMode === 'FIXED_PRICE'
      ? parseFloat((product.currentPrice - value).toFixed(2))
      : value;

    saveDeal.mutate(
      {
        productsId: product.productsId,
        productCode: product.productCode,
        discountType,
        discountValue: apiDiscountValue,
        dealDate: date,
      },
      {
        onSuccess: (data) => {
          const newDealId = data?.data?.dealId;
          if (newDealId) {
            setRecentlyAddedDealId(newDealId);
          }
        },
      },
    );
  };

  const handleDeleteDeal = (dealId: number) => {
    deleteDeal.mutate(dealId);
  };

  // Calculate preview price
  const previewPrice = (() => {
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) return null;
    if (inputMode === 'PERCENT') {
      return product.currentPrice - (product.currentPrice * value / 100);
    }
    if (inputMode === 'FIXED_PRICE') {
      return value; // The entered value IS the final price
    }
    return product.currentPrice - value;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[950px] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Schedule Deal: {product.productName}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Product Code: {product.productCode} | Products Price: £{product.currentPrice.toFixed(2)}
            {isOnSale && (
              <span className="text-red-600 font-semibold"> | Site Price: £{freshSitePrice.toFixed(2)} (on sale)</span>
            )}
            {!isOnSale && freshSitePrice !== product.currentPrice && (
              <span> | Site Price: £{freshSitePrice.toFixed(2)}</span>
            )}
          </p>
        </DialogHeader>

        {/* Discount Form */}
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="flex items-center gap-6 flex-wrap">
            <RadioGroup
              value={inputMode}
              onValueChange={(val) => { setInputMode(val as 'PERCENT' | 'FIXED' | 'FIXED_PRICE'); setDiscountValue(''); setError(''); }}
              className="flex items-center gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PERCENT" id="percent" />
                <Label htmlFor="percent">Discount Percentage (%)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="FIXED" id="fixed" />
                <Label htmlFor="fixed">Fixed Discount Amount (£)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="FIXED_PRICE" id="fixed-price" />
                <Label htmlFor="fixed-price">Actual Sale Price (£)</Label>
              </div>
            </RadioGroup>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={inputMode === 'PERCENT' ? 'e.g. 20' : inputMode === 'FIXED_PRICE' ? 'e.g. 30.00' : 'e.g. 10.00'}
                className="w-[120px]"
                value={discountValue}
                onChange={(e) => { setDiscountValue(e.target.value); setError(''); }}
              />
              <span className="text-sm text-muted-foreground">
                {inputMode === 'PERCENT' ? '%' : '£'}
              </span>
            </div>

            {previewPrice !== null && previewPrice > 0 && previewPrice < product.currentPrice && (
              <span className="text-sm font-medium text-green-700">
                Deal Price: £{previewPrice.toFixed(2)}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        {/* Week navigation */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={handlePrevWeek}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev Week
          </Button>
          <span className="text-sm font-medium">
            {formatDateHeader(startDate)} — {formatDateHeader(endDate)}
          </span>
          <Button variant="outline" size="sm" onClick={handleNextWeek}>
            Next Week <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading schedule...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border p-2 bg-muted text-left w-[50px]">Slot</th>
                  {weekDates.map((date) => (
                    <th
                      key={date}
                      className={`border p-2 text-center min-w-[110px] ${date === today ? 'bg-blue-50' : 'bg-muted'}`}
                    >
                      <div>{formatDateHeader(date)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(dealsByDate[date] || []).length}/{MAX_DEALS_PER_DAY}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: MAX_DEALS_PER_DAY }, (_, slotIdx) => (
                  <tr key={slotIdx}>
                    <td className="border p-1 text-center font-medium bg-muted text-xs">{slotIdx + 1}</td>
                    {weekDates.map((date) => {
                      const deals = dealsByDate[date] || [];
                      const deal = deals[slotIdx];
                      const isPast = date < today;
                      const isFull = deals.length >= MAX_DEALS_PER_DAY;
                      const isHighlighted = deal && deal.dealId === recentlyAddedDealId;

                      if (deal) {
                        return (
                          <td
                            key={date}
                            className={`border p-1 align-top transition-all duration-700 ${
                              isHighlighted
                                ? 'bg-green-100 ring-2 ring-green-500 ring-inset'
                                : getDealBgColor(deal)
                            }`}
                          >
                            <div className="text-xs space-y-0.5">
                              <div className="font-medium truncate" title={deal.productName}>
                                {deal.productName.length > 15
                                  ? deal.productName.substring(0, 15) + '...'
                                  : deal.productName}
                              </div>
                              <div className="text-green-700 font-semibold text-[11px]">
                                {formatDiscount(deal.discountType, deal.discountValue)}
                              </div>
                              {!isPast && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => handleDeleteDeal(deal.dealId)}
                                  disabled={deleteDeal.isPending}
                                  title="Remove deal"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </td>
                        );
                      }

                      if (isPast) {
                        return (
                          <td key={date} className="border p-1 text-center text-muted-foreground text-xs">—</td>
                        );
                      }

                      if (isFull) {
                        return (
                          <td key={date} className="border p-1 text-center text-muted-foreground text-[10px]">Full</td>
                        );
                      }

                      return (
                        <td key={date} className="border p-1 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            onClick={() => handleAddDeal(date)}
                            disabled={saveDeal.isPending || !discountValue}
                            title={discountValue ? `Add ${inputMode === 'PERCENT' ? discountValue + '% off' : inputMode === 'FIXED_PRICE' ? '£' + discountValue + ' final price' : '£' + discountValue + ' off'} deal` : 'Set discount first'}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
