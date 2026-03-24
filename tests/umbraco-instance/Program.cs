WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddComposers()
    .Build();

// Allow HTTP for token endpoint in development (workerd can't verify self-signed certs).
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddOpenIddict()
        .AddServer(options =>
        {
            options.UseAspNetCore()
                .DisableTransportSecurityRequirement();
        });
}

WebApplication app = builder.Build();

await app.BootUmbracoAsync();

app.UseUmbraco()
    .WithMiddleware(u =>
    {
        u.UseBackOffice();
        u.UseWebsite();
    })
    .WithEndpoints(u =>
    {
        u.UseBackOfficeEndpoints();
        u.UseWebsiteEndpoints();
    });

await app.RunAsync();
