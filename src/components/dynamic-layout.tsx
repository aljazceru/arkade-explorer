import { TopNav } from "@/components/nav/top-nav";
import { Footer } from "@/components/nav/footer";

export function DynamicLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <TopNav />
            <main className="flex-1 max-w-[1480px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
                {children}
            </main>
            <Footer />
        </div>
    );
}
