import { TopNav } from "@/components/nav/top-nav";
import { Footer } from "@/components/nav/footer";

export function DynamicLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-background">
            <TopNav />
            <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 pb-16 pt-5 sm:px-5">
                {children}
            </main>
            <Footer />
        </div>
    );
}
