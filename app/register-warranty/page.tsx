"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Store = {
  id: string;
  store_name: string;
};

type Category = {
  id: string;
  category_name: string;
};

type Brand = {
  id: string;
  brand_name: string;
};

type Product = {
  id: string;
  product_name: string;
  sku: string | null;
  default_warranty_months: number;
  brand_id: string | null;
  category_id: string | null;
};

type RegistrationResult = {
  warranty_number: string;
  warranty_start_date: string;
  warranty_expiry_date: string;
  status: string;
  verification_token: string;
};

export default function RegisterWarrantyPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [storeId, setStoreId] = useState("");

  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [productId, setProductId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [extendedWarrantyPurchased, setExtendedWarrantyPurchased] =
  useState(false);

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationAccuracy, setLocationAccuracy] =
    useState<number | null>(null);

  const [locationMessage, setLocationMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] =
    useState<RegistrationResult | null>(null);

  useEffect(() => {
    const loadMasterData = async () => {
      try {
        const [
          storesResult,
          categoriesResult,
          brandsResult,
          productsResult,
        ] = await Promise.all([
          supabase
            .from("stores")
            .select("id, store_name")
            .eq("is_active", true)
            .order("store_name"),

          supabase
            .from("product_categories")
            .select("id, category_name")
            .eq("is_active", true)
            .order("category_name"),

          supabase
            .from("brands")
            .select("id, brand_name")
            .eq("is_active", true)
            .order("brand_name"),

          supabase
            .from("products")
            .select(
              "id, product_name, sku, default_warranty_months, brand_id, category_id"
            )
            .eq("is_active", true)
            .order("product_name"),
        ]);

        setStores(storesResult.data ?? []);
        setCategories(categoriesResult.data ?? []);
        setBrands(brandsResult.data ?? []);
        setProducts(productsResult.data ?? []);
      } catch (error) {
        console.error("Master data loading error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadMasterData();
  }, []);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const categoryMatches =
        !categoryId || product.category_id === categoryId;

      const brandMatches =
        !brandId || product.brand_id === brandId;

      return categoryMatches && brandMatches;
    });
  }, [products, categoryId, brandId]);

  const captureLocation = () => {
    setLocationMessage("");

    if (!navigator.geolocation) {
      setLocationMessage(
        "Location is not supported by this browser."
      );
      return;
    }

    setLocationMessage("Capturing current location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setLocationAccuracy(position.coords.accuracy);

        setLocationMessage(
          `Location captured successfully. Accuracy: approximately ${Math.round(
            position.coords.accuracy
          )} metres.`
        );
      },
      (error) => {
        setLocationMessage(
          `Unable to capture location: ${error.message}`
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setErrorMessage("");
    setResult(null);

    const cleanMobile = mobileNumber.replace(/\D/g, "");

    if (!fullName.trim()) {
      setErrorMessage("Please enter the customer name.");
      return;
    }

    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      setErrorMessage(
        "Please enter a valid 10-digit Indian mobile number."
      );
      return;
    }

    if (!invoiceNumber.trim()) {
      setErrorMessage("Please enter the invoice number.");
      return;
    }

    if (!purchaseDate) {
      setErrorMessage("Please select the purchase date.");
      return;
    }

    if (!storeId) {
      setErrorMessage(
        "Please select the Seven Years location."
      );
      return;
    }

    if (!productId) {
      setErrorMessage("Please select the product.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        "/api/warranty/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName,
            mobileNumber: cleanMobile,
            email,
            invoiceNumber,
            purchaseDate,
            storeId,
            productId,
            serialNumber,
            latitude,
            longitude,
            locationAccuracy,
            extendedWarrantyPurchased,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(
          data.error || "Unable to register warranty."
        );
        return;
      }

      setResult(data.warranty);

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch {
      setErrorMessage(
        "Something went wrong while registering the warranty."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <main className="min-h-screen bg-[#f7f9fb] px-4 py-10 text-[#161616]">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl bg-white p-7 shadow-sm ring-1 ring-black/5 sm:p-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
              ✓
            </div>

            <p className="mt-6 text-sm font-bold text-[#ff5e79]">
              Seven Years Care
            </p>

            <h1 className="mt-2 text-3xl font-bold">
              Warranty Registered
            </h1>

            <p className="mt-3 text-black/60">
              Your product warranty has been registered
              successfully.
            </p>

            <div className="mt-8 rounded-3xl bg-[#161616] p-6 text-white">
              <p className="text-xs uppercase tracking-wider text-white/60">
                Warranty Number
              </p>

              <p className="mt-2 text-2xl font-bold">
                {result.warranty_number}
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-white/50">
                    Warranty Start
                  </p>
                  <p className="mt-1 font-semibold">
                    {result.warranty_start_date}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-white/50">
                    Warranty Expiry
                  </p>
                  <p className="mt-1 font-semibold">
                    {result.warranty_expiry_date}
                  </p>
                </div>
              </div>
            </div>

            {result.verification_token && (
              <a
                href={`/warranty/${result.verification_token}`}
                className="mt-6 block rounded-2xl bg-[#11b8d0] p-4 text-center font-bold text-white"
              >
                View Digital Warranty Certificate
              </a>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/"
                className="rounded-2xl bg-[#161616] px-6 py-3 text-center font-bold text-white"
              >
                Back to Home
              </a>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-2xl border border-black/10 px-6 py-3 font-bold"
              >
                Register Another Product
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] px-4 py-8 text-[#161616]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <a
            href="/"
            className="mb-5 inline-block text-sm font-semibold text-black/50"
          >
            ← Back to Seven Years Care
          </a>

          <p className="text-sm font-semibold text-[#ff5e79]">
            Seven Years Care
          </p>

          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            Register Warranty
          </h1>

          <p className="mt-3 text-sm leading-6 text-black/60 sm:text-base">
            Register your Seven Years purchase to keep your warranty
            details and certificate safely available.
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-8">
          {loading ? (
            <p className="text-sm text-black/60">
              Loading warranty details...
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <section>
                <h2 className="text-lg font-bold">
                  1. Customer Details
                </h2>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) =>
                        setFullName(e.target.value)
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none"
                      placeholder="Customer name"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Mobile Number *
                    </label>

                    <div className="flex">
                      <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                        +91
                      </div>

                      <input
                        type="tel"
                        value={mobileNumber}
                        onChange={(e) =>
                          setMobileNumber(e.target.value)
                        }
                        maxLength={10}
                        className="w-full rounded-r-2xl border border-black/10 px-4 py-3 outline-none"
                        placeholder="10-digit mobile number"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-semibold">
                      Email
                    </label>

                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none"
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold">
                  2. Purchase Details
                </h2>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Invoice Number *
                    </label>

                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) =>
                        setInvoiceNumber(e.target.value)
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none"
                      placeholder="Invoice number"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Purchase Date *
                    </label>

                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) =>
                        setPurchaseDate(e.target.value)
                      }
                      max={
                        new Date()
                          .toISOString()
                          .split("T")[0]
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-semibold">
                      Purchased From *
                    </label>

                    <select
                      value={storeId}
                      onChange={(e) =>
                        setStoreId(e.target.value)
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3"
                    >
                      <option value="">
                        Select Seven Years location
                      </option>

                      {stores.map((store) => (
                        <option
                          key={store.id}
                          value={store.id}
                        >
                          {store.store_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold">
                  3. Product Details
                </h2>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Category
                    </label>

                    <select
                      value={categoryId}
                      onChange={(e) => {
                        setCategoryId(e.target.value);
                        setProductId("");
                      }}
                      className="w-full rounded-2xl border border-black/10 px-4 py-3"
                    >
                      <option value="">
                        All categories
                      </option>

                      {categories.map((category) => (
                        <option
                          key={category.id}
                          value={category.id}
                        >
                          {category.category_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold">
                      Brand
                    </label>

                    <select
                      value={brandId}
                      onChange={(e) => {
                        setBrandId(e.target.value);
                        setProductId("");
                      }}
                      className="w-full rounded-2xl border border-black/10 px-4 py-3"
                    >
                      <option value="">
                        All brands
                      </option>

                      {brands.map((brand) => (
                        <option
                          key={brand.id}
                          value={brand.id}
                        >
                          {brand.brand_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-semibold">
                      Product *
                    </label>

                    <select
                      value={productId}
                      onChange={(e) =>
                        setProductId(e.target.value)
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3"
                    >
                      <option value="">
                        Select product
                      </option>

                      {filteredProducts.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                        >
                          {product.product_name}
                          {product.sku
                            ? ` - ${product.sku}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-semibold">
                      Serial Number
                    </label>

                    <input
                      type="text"
                      value={serialNumber}
                      onChange={(e) =>
                        setSerialNumber(e.target.value)
                      }
                      className="w-full rounded-2xl border border-black/10 px-4 py-3 outline-none"
                      placeholder="If applicable"
                    />
                  </div>
                </div>
              </section>

<section>
  <h2 className="text-lg font-bold">
    4. Warranty Coverage
  </h2>

  <p className="mt-2 text-sm leading-6 text-black/60">
    Standard Warranty is included with eligible products.
    You may also add the Extended Warranty for an additional
    6 months of coverage.
  </p>

  <div className="mt-4 space-y-4">

    <div className="rounded-2xl border border-[#11b8d0]/30 bg-[#11b8d0]/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#11b8d0]">
            STANDARD WARRANTY
          </p>

          <p className="mt-1 text-2xl font-bold">
            6 Months
          </p>

          <p className="mt-2 text-sm leading-6 text-black/60">
            Included with the product purchase.
          </p>
        </div>

        <div className="rounded-full bg-[#11b8d0] px-3 py-1 text-xs font-bold text-white">
          INCLUDED
        </div>
      </div>
    </div>

    <div
      className={`rounded-2xl border p-5 transition ${
        extendedWarrantyPurchased
          ? "border-[#ff5e79] bg-[#ff5e79]/5 ring-2 ring-[#ff5e79]/10"
          : "border-black/10 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#ff5e79]">
            EXTENDED WARRANTY
          </p>

          <p className="mt-1 text-2xl font-bold">
            Additional 6 Months
          </p>

          <p className="mt-2 text-sm font-semibold">
            ₹1,200
          </p>

          <p className="mt-2 text-sm leading-6 text-black/60">
            Extends warranty coverage for another 6 months
            after the Standard Warranty expires.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setExtendedWarrantyPurchased(
              !extendedWarrantyPurchased
            )
          }
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${
            extendedWarrantyPurchased
              ? "bg-[#ff5e79] text-white"
              : "border border-[#ff5e79] text-[#ff5e79]"
          }`}
        >
          {extendedWarrantyPurchased
            ? "Added ✓"
            : "Add Warranty"}
        </button>
      </div>

      {extendedWarrantyPurchased && (
        <div className="mt-4 rounded-xl bg-white/70 p-4">
          <p className="text-sm font-bold">
            Extended Warranty Added
          </p>

          <p className="mt-1 text-sm leading-6 text-black/60">
            The ₹1,200 Extended Warranty fee will be recorded
            with this registration. Total coverage becomes
            12 months from the original purchase date.
          </p>
        </div>
      )}
    </div>

  </div>
</section>

<section>
  <h2 className="text-lg font-bold">
    5. Service Location
  </h2>
                <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[#fafafa] p-5">
                  <p className="text-sm leading-6 text-black/60">
                    Share your current location so future service
                    requests can be routed correctly.
                  </p>

                  <button
                    type="button"
                    onClick={captureLocation}
                    className="mt-4 cursor-pointer rounded-2xl bg-[#11b8d0] px-5 py-3 text-sm font-bold text-white"
                  >
                    {latitude !== null
                      ? "Update Current Location"
                      : "Use Current Location"}
                  </button>

                  {locationMessage && (
                    <p className="mt-3 text-sm text-black/60">
                      {locationMessage}
                    </p>
                  )}
                </div>
              </section>

              {errorMessage && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-[#ff5e79] px-5 py-4 text-base font-bold text-white disabled:opacity-50"
              >
                {submitting
                  ? "Registering Warranty..."
                  : "Register Warranty"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}