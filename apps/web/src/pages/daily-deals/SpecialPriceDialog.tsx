import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSpecialPriceInfo, useSetSpecialPrice, useRemoveSpecialPrice } from './hooks/useDailyDeals';

interface SpecialPriceDialogProps {
  product: {
    productsId: number;
    productCode: string;
    productName: string;
    currentPrice: number;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpecialPriceDialog({ product, open, onOpenChange }: SpecialPriceDialogProps) {
  const [specialPrice, setSpecialPrice] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  const { data: specialInfo, isLoading } = useSpecialPriceInfo(open ? product.productsId : 0);
  const setSpecial = useSetSpecialPrice();
  const removeSpecial = useRemoveSpecialPrice();

  const info = specialInfo?.data;
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (info) {
      setSpecialPrice(info.hasSpecial ? String(info.specialPrice) : '');
      setStartDate(info.hasSpecial && info.startDate !== '0001-01-01' ? info.startDate : today);
      setEndDate(info.hasSpecial && info.endDate !== '0001-01-01' ? info.endDate : '');
    } else {
      setSpecialPrice('');
      setStartDate(today);
      setEndDate('');
    }
    setError('');
  }, [info, today]);

  const handleSave = () => {
    const price = parseFloat(specialPrice);
    if (isNaN(price) || price <= 0) {
      setError('Enter a valid price');
      return;
    }
    if (price >= product.currentPrice) {
      setError(`Special price must be less than current price (${product.currentPrice.toFixed(2)})`);
      return;
    }
    if (!startDate) {
      setError('Start date is required');
      return;
    }
    setError('');
    setSpecial.mutate(
      {
        productsId: product.productsId,
        specialPrice: price,
        startDate,
        endDate: endDate || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const handleRemove = () => {
    removeSpecial.mutate(product.productsId, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Set Special Price</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {product.productName}
          </p>
          <p className="text-sm text-muted-foreground">
            Code: {product.productCode} | Current Price: {product.currentPrice.toFixed(2)}
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Special Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 29.99"
                value={specialPrice}
                onChange={(e) => { setSpecialPrice(e.target.value); setError(''); }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>End Date <span className="text-muted-foreground text-xs">(empty = permanent)</span></Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {specialPrice && parseFloat(specialPrice) > 0 && parseFloat(specialPrice) < product.currentPrice && (
              <p className="text-sm text-green-700 font-medium">
                Discount: {((1 - parseFloat(specialPrice) / product.currentPrice) * 100).toFixed(0)}% off
                ({product.currentPrice.toFixed(2)} &rarr; {parseFloat(specialPrice).toFixed(2)})
              </p>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {info?.hasSpecial && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemove}
                disabled={removeSpecial.isPending}
              >
                Remove Special
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={setSpecial.isPending || isLoading}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
